"""NomaanOS Nexus AI - Local Embedding Adapter (Day 9).

Provides local CPU execution of sentence-transformers/all-MiniLM-L6-v2 (384 dimensions)
with strict offline mode support, L2 normalization, dimension validation, long text truncation,
and both Python library and CLI interfaces.
"""

import os
import sys
import math
import json
import logging
import argparse
from typing import List, Dict, Any, Optional

logger = logging.getLogger("nexus-embedding")

DEFAULT_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_DIMENSIONS = 384
DEFAULT_METRIC = "cosine"
DEFAULT_BATCH_SIZE = 32
MAX_CHARS_SAFE_LIMIT = 4096  # Safeguard against excessive memory usage


class EmbeddingError(Exception):
    """Base exception for embedding adapter failures."""
    pass


class DimensionMismatchError(EmbeddingError):
    """Raised when generated embedding does not match required dimensions."""
    pass


class ModelNotFoundError(EmbeddingError):
    """Raised when model weights or cache cannot be located."""
    pass


class LocalEmbeddingAdapter:
    """Local embedding generator using sentence-transformers/all-MiniLM-L6-v2.
    
    Operates strictly on local CPU without cloud inference dependencies.
    Honors offline execution flags (NEXUS_OFFLINE_MODE, TRANSFORMERS_OFFLINE, HF_HUB_OFFLINE).
    """

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        device: str = "cpu",
        offline_mode: Optional[bool] = None,
    ):
        self.model_id = model_id
        self.device = device
        
        # Determine offline mode from parameter or environment
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
        self._dimensions = DEFAULT_DIMENSIONS

    def _load_model(self):
        """Loads SentenceTransformer model locally with offline verification."""
        if self._model is not None:
            return self._model

        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise EmbeddingError(
                "sentence-transformers is not installed. Install via 'pip install sentence-transformers'."
            ) from e

        try:
            # Set Hugging Face offline environment variables if required
            if self.offline_mode:
                os.environ["TRANSFORMERS_OFFLINE"] = "1"
                os.environ["HF_HUB_OFFLINE"] = "1"

            logger.info(f"Loading local embedding model '{self.model_id}' on device '{self.device}' (offline={self.offline_mode})")
            model = SentenceTransformer(self.model_id, device=self.device, local_files_only=self.offline_mode)
            
            # Verify model dimensionality
            test_emb = model.encode("dim check", normalize_embeddings=True)
            if len(test_emb) != DEFAULT_DIMENSIONS:
                raise DimensionMismatchError(
                    f"Model '{self.model_id}' produced {len(test_emb)} dimensions, expected {DEFAULT_DIMENSIONS}."
                )

            self._model = model
            self._dimensions = len(test_emb)
            return self._model

        except Exception as ex:
            err_msg = str(ex)
            if "offline" in err_msg.lower() or "not found" in err_msg.lower() or "could not reach" in err_msg.lower() or "connection" in err_msg.lower():
                raise ModelNotFoundError(
                    f"Local model '{self.model_id}' could not be loaded in offline mode. Ensure files are cached: {ex}"
                ) from ex
            raise EmbeddingError(f"Failed to initialize embedding model '{self.model_id}': {ex}") from ex

    def get_dimensions(self) -> int:
        """Returns the embedding dimensions (384)."""
        return self._dimensions

    def get_model_info(self) -> Dict[str, Any]:
        """Returns model metadata and configuration."""
        return {
            "model_id": self.model_id,
            "model_name": self.model_id.split("/")[-1],
            "provider": "local",
            "device": self.device,
            "dimensions": self._dimensions,
            "distance_metric": DEFAULT_METRIC,
            "is_normalized": True,
            "offline_mode": self.offline_mode,
        }

    def validate_embedding(self, vector: List[float]) -> bool:
        """Validates that vector is non-empty, matches 384 dimensions, and contains valid finite floats."""
        if not isinstance(vector, (list, tuple)):
            return False
        if len(vector) != self._dimensions:
            return False
        for val in vector:
            if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val):
                return False
        return True

    def _preprocess_text(self, text: str) -> str:
        """Sanitizes text and truncates safely to prevent memory blowups."""
        if text is None:
            return ""
        if not isinstance(text, str):
            text = str(text)
        cleaned = text.strip()
        if len(cleaned) > MAX_CHARS_SAFE_LIMIT:
            cleaned = cleaned[:MAX_CHARS_SAFE_LIMIT]
        return cleaned

    def embed_text(self, text: str) -> List[float]:
        """Generates a normalized 384-dimensional embedding for a single text string."""
        model = self._load_model()
        cleaned_text = self._preprocess_text(text)
        
        # If text is empty or purely whitespace, embed fallback placeholder for consistent 384-dim vector
        effective_text = cleaned_text if cleaned_text else " "

        try:
            embedding = model.encode(effective_text, normalize_embeddings=True)
            emb_list = [float(x) for x in embedding]
            
            if not self.validate_embedding(emb_list):
                raise DimensionMismatchError(
                    f"Generated embedding validation failed: length {len(emb_list)}, expected {self._dimensions}"
                )
            return emb_list
        except Exception as e:
            if isinstance(e, EmbeddingError):
                raise
            raise EmbeddingError(f"Embedding generation failed: {e}") from e

    def embed_batch(self, texts: List[str], batch_size: int = DEFAULT_BATCH_SIZE) -> List[List[float]]:
        """Generates normalized embeddings for a batch of texts in batches."""
        if not texts:
            return []

        model = self._load_model()
        cleaned_texts = [self._preprocess_text(t) or " " for t in texts]

        try:
            embeddings = model.encode(
                cleaned_texts,
                batch_size=batch_size,
                normalize_embeddings=True,
                show_progress_bar=False,
            )

            results: List[List[float]] = []
            for emb in embeddings:
                emb_list = [float(x) for x in emb]
                if not self.validate_embedding(emb_list):
                    raise DimensionMismatchError(
                        f"Batch embedding validation failed: length {len(emb_list)}, expected {self._dimensions}"
                    )
                results.append(emb_list)
            return results
        except Exception as e:
            if isinstance(e, EmbeddingError):
                raise
            raise EmbeddingError(f"Batch embedding generation failed: {e}") from e


def serve(model_id: str = DEFAULT_MODEL_ID, offline: bool = True):
    """Runs persistent stdio embedding daemon to eliminate repeat PyTorch initialization overhead."""
    adapter = LocalEmbeddingAdapter(model_id=model_id, offline_mode=offline)
    adapter._load_model()
    # Write ready handshake
    sys.stdout.write(json.dumps({"status": "ready", "dimensions": adapter.get_dimensions(), "model": adapter.model_id}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            if "text" in req:
                emb = adapter.embed_text(req["text"])
                res = {"id": req_id, "dimensions": len(emb), "embedding": emb}
            elif "batch" in req:
                embs = adapter.embed_batch(req["batch"])
                res = {"id": req_id, "dimensions": adapter.get_dimensions(), "embeddings": embs}
            elif "info" in req:
                res = {"id": req_id, "info": adapter.get_model_info()}
            else:
                res = {"id": req_id, "error": "Invalid request"}
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"id": req_id, "error": str(e)}) + "\n")
            sys.stdout.flush()


def main():
    """CLI entry point for running embedding commands."""
    parser = argparse.ArgumentParser(description="Nexus AI Local Embedding CLI (Day 9)")
    parser.add_argument("--text", type=str, help="Single text string to embed")
    parser.add_argument("--batch", type=str, help="JSON array of strings to embed in batch")
    parser.add_argument("--info", action="store_true", help="Print model metadata")
    parser.add_argument("--serve", action="store_true", help="Run as persistent stdio embedding daemon")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL_ID, help="Model identifier")
    parser.add_argument("--offline", action="store_true", help="Enforce strict offline execution")

    args = parser.parse_args()

    if args.serve:
        serve(model_id=args.model, offline=args.offline)
        sys.exit(0)

    adapter = LocalEmbeddingAdapter(model_id=args.model, offline_mode=args.offline)

    if args.info:
        print(json.dumps(adapter.get_model_info()))
        sys.exit(0)

    if args.text is not None:
        try:
            emb = adapter.embed_text(args.text)
            print(json.dumps({
                "model": adapter.model_id,
                "dimensions": len(emb),
                "embedding": emb
            }))
            sys.exit(0)
        except Exception as ex:
            print(json.dumps({"error": str(ex)}), file=sys.stderr)
            sys.exit(1)

    if args.batch is not None:
        try:
            texts = json.loads(args.batch)
            if not isinstance(texts, list):
                raise ValueError("--batch must be a JSON array of strings")
            embeddings = adapter.embed_batch(texts)
            print(json.dumps({
                "model": adapter.model_id,
                "dimensions": adapter.get_dimensions(),
                "count": len(embeddings),
                "embeddings": embeddings
            }))
            sys.exit(0)
        except Exception as ex:
            print(json.dumps({"error": str(ex)}), file=sys.stderr)
            sys.exit(1)

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
