"""NomaanOS Nexus AI - Local Reranker Adapter (Day 12).

Provides local cross-encoder reranking over candidate chunks using
sentence-transformers/cross-encoder or a fallback lexical-semantic cross-scorer.
Supports strict offline mode, long-text truncation, and both library and CLI/daemon interfaces.
"""

import os
import sys
import json
import logging
import argparse
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger("nexus-reranker")

DEFAULT_RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
MAX_CHARS_SAFE_LIMIT = 2048


class RerankerError(Exception):
    """Base exception for reranker failures."""
    pass


class LocalRerankerAdapter:
    """Local reranking adapter for candidate chunks.
    
    Uses CrossEncoder where available, with safe fallback to lexical-semantic cross-scoring
    when offline or when model weights are not pre-cached.
    """

    def __init__(
        self,
        model_id: str = DEFAULT_RERANKER_MODEL,
        device: str = "cpu",
        offline_mode: Optional[bool] = None,
    ):
        self.model_id = model_id
        self.device = device

        if offline_mode is not None:
            self.offline_mode = offline_mode
        else:
            nexus_offline = os.getenv("NEXUS_OFFLINE_MODE", "").lower() in ("true", "1", "yes")
            tf_offline = os.getenv("TRANSFORMERS_OFFLINE", "").lower() in ("true", "1", "yes")
            hf_offline = os.getenv("HF_HUB_OFFLINE", "").lower() in ("true", "1", "yes")
            self.offline_mode = nexus_offline or tf_offline or hf_offline

        if self.offline_mode:
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            os.environ["HF_HUB_OFFLINE"] = "1"

        self._model = None
        self._load_attempted = False

    def _get_model(self):
        """Attempts to load CrossEncoder model locally; returns None if not available."""
        if self._load_attempted:
            return self._model

        self._load_attempted = True
        try:
            from sentence_transformers import CrossEncoder
            logger.info(f"Loading local cross-encoder '{self.model_id}' on device '{self.device}' (offline={self.offline_mode})")
            try:
                # Prioritize local cache with local_files_only to prevent network hangs
                model = CrossEncoder(self.model_id, device=self.device, local_files_only=True)
            except Exception:
                if not self.offline_mode:
                    model = CrossEncoder(self.model_id, device=self.device)
                else:
                    raise
            self._model = model
            return self._model
        except Exception as e:
            logger.warning(f"CrossEncoder model '{self.model_id}' could not be loaded locally ({e}). Using heuristic cross-scoring fallback.")
            self._model = None
            return None

    def rerank_pairs(self, query: str, texts: List[str]) -> List[float]:
        """Calculates relevance scores for (query, text) pairs.
        
        Returns a list of float scores corresponding to the candidate texts.
        """
        if not texts:
            return []

        clean_query = (query or "").strip()
        truncated_texts = [(t or "")[:MAX_CHARS_SAFE_LIMIT] for t in texts]

        model = self._get_model()
        if model is not None:
            try:
                pairs = [[clean_query, t] for t in truncated_texts]
                raw_scores = model.predict(pairs)
                # Convert numpy array or list to python float list
                return [float(s) for s in raw_scores]
            except Exception as e:
                logger.warning(f"CrossEncoder inference failed ({e}). Falling back to heuristic cross-scorer.")

        # Fallback: Deterministic Lexical-Semantic Cross-Scorer
        return self._heuristic_cross_scores(clean_query, truncated_texts)

    def _heuristic_cross_scores(self, query: str, texts: List[str]) -> List[float]:
        """High-precision heuristic cross-scoring fallback.
        
        Awards scores for exact query match, token overlap, technical acronym matches,
        and term-frequency density.
        """
        query_lower = query.lower()
        query_tokens = [w for w in query_lower.split() if len(w) > 1]
        token_count = max(1, len(query_tokens))

        scores: List[float] = []
        for text in texts:
            text_lower = text.lower()
            score = 0.0

            # 1. Exact query substring match
            if query_lower in text_lower:
                score += 0.50

            # 2. Token overlap fraction
            matched_tokens = sum(1 for tok in query_tokens if tok in text_lower)
            score += 0.35 * (matched_tokens / token_count)

            # 3. Exact technical identifier / error code match (e.g. ERR_..., /api/..., node-...)
            for tok in query_tokens:
                if tok.isupper() or tok.startswith("/") or "-" in tok:
                    if tok in text_lower:
                        score += 0.15

            # 4. Length penalty / density
            density = min(1.0, (matched_tokens * 10) / max(1, len(text.split())))
            score += 0.05 * density

            # Normalize to 0.0 - 1.0 range
            scores.append(round(min(1.0, max(0.0, score)), 4))

        return scores


def main():
    parser = argparse.ArgumentParser(description="Nexus AI Local Reranker CLI")
    parser.add_argument("--query", type=str, help="Search query")
    parser.add_argument("--candidates", type=str, help="JSON array of candidate texts")
    parser.add_argument("--serve", action="store_true", help="Run as stdio JSON-RPC service")
    parser.add_argument("--model", type=str, default=DEFAULT_RERANKER_MODEL, help="Cross-encoder model name")
    parser.add_argument("--device", type=str, default="cpu", help="Compute device (cpu, cuda)")

    args = parser.parse_args()
    adapter = LocalRerankerAdapter(model_id=args.model, device=args.device)

    if args.serve:
        # Stdio streaming service for TypeScript API integration
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                query = payload.get("query", "")
                texts = payload.get("candidates", [])
                scores = adapter.rerank_pairs(query, texts)
                print(json.dumps({"status": "ok", "scores": scores}), flush=True)
            except Exception as e:
                print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        return

    if args.query and args.candidates:
        try:
            texts = json.loads(args.candidates)
            scores = adapter.rerank_pairs(args.query, texts)
            print(json.dumps({"scores": scores}))
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
