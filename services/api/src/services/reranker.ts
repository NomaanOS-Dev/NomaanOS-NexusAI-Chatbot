/**
 * NomaanOS Nexus AI - Modular Reranker Service (Day 12)
 *
 * Implements configurable reranking using local cross-encoder models
 * (sentence-transformers/cross-encoder) and deterministic heuristic cross-scoring.
 * Safely handles unavailable models, timeouts, and empty candidate sets while
 * strictly preserving candidate chunk metadata, provenance, and tenant isolation.
 */

import { spawn } from 'child_process';
import path from 'path';
import { logger } from '../config/logger.js';
import { HybridSearchResultItem } from './rrf.js';

export interface RerankOptions {
  modelId?: string;
  topK?: number;
  minRelevanceScore?: number;
  strategy?: 'cross-encoder' | 'heuristic' | 'auto';
  timeoutMs?: number;
}

export interface RerankResult {
  modelId: string;
  strategyUsed: 'cross-encoder' | 'heuristic';
  timingMs: number;
  totalCandidates: number;
  results: HybridSearchResultItem[];
}

export const DEFAULT_RERANKER_MODEL = 'cross-encoder/ms-marco-MiniLM-L-6-v2';

/**
 * Heuristic cross-scoring strategy: Fast, deterministic, zero-dependency.
 */
export function scoreHeuristicCross(query: string, text: string): number {
  if (!query || !text) return 0.0;

  const queryLower = query.toLowerCase().trim();
  const textLower = text.toLowerCase();
  const queryTokens = queryLower.split(/[\s,.;:!?()\/]+/).filter((t) => t.length > 1);

  if (queryTokens.length === 0) return 0.0;

  let score = 0.0;

  // 1. Exact query match boost
  if (textLower.includes(queryLower)) {
    score += 0.50;
  }

  // 2. Token overlap fraction
  let matchedTokens = 0;
  for (const token of queryTokens) {
    if (textLower.includes(token)) {
      matchedTokens++;
    }
  }
  score += 0.35 * (matchedTokens / queryTokens.length);

  // 3. Technical identifier / error code exact match boost
  for (const token of queryTokens) {
    if (token.includes('_') || token.includes('-') || token.startsWith('/') || /^[A-Z0-9_]{4,}$/.test(token)) {
      if (textLower.includes(token.toLowerCase())) {
        score += 0.15;
      }
    }
  }

  // 4. Token density bonus
  const textWords = text.split(/\s+/).length;
  const density = Math.min(1.0, (matchedTokens * 10) / Math.max(1, textWords));
  score += 0.05 * density;

  return Math.min(1.0, Math.max(0.0, Math.round(score * 10000) / 10000));
}

/**
 * Executes Python CrossEncoder CLI to score pairs.
 */
async function scorePairsWithPython(
  query: string,
  texts: string[],
  modelId: string,
  timeoutMs = 4000
): Promise<number[] | null> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      resolved = true;
    };

    timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        logger.warn('Python cross-encoder timed out, falling back to heuristic reranker');
        resolve(null);
      }
    }, timeoutMs);

    try {
      const pythonExe = process.env.PYTHON_PATH || 'C:\\Users\\NK-WorkStation\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
      const parserDir = path.resolve(process.cwd(), '../parser/src');

      const proc = spawn(
        pythonExe,
        ['-m', 'nexus_parser.reranker', '--serve', '--model', modelId],
        {
          cwd: parserDir,
          env: {
            ...process.env,
            PYTHONPATH: parserDir,
            TRANSFORMERS_OFFLINE: '1',
            HF_HUB_OFFLINE: '1',
          },
        }
      );

      let stdoutData = '';
      let stderrData = '';

      proc.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      proc.on('close', (code) => {
        if (!resolved) {
          cleanup();
          if (code === 0 && stdoutData) {
            try {
              const lines = stdoutData.trim().split('\n');
              const lastLine = lines[lines.length - 1];
              const parsed = JSON.parse(lastLine);
              if (parsed.status === 'ok' && Array.isArray(parsed.scores)) {
                resolve(parsed.scores);
                return;
              }
            } catch {}
          }
          logger.warn({ stderrData, code }, 'Python cross-encoder returned non-zero or invalid response');
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        if (!resolved) {
          cleanup();
          logger.warn({ err }, 'Failed to spawn Python cross-encoder process');
          resolve(null);
        }
      });

      // Send payload via stdio
      const payload = JSON.stringify({ query, candidates: texts }) + '\n';
      proc.stdin.write(payload);
      proc.stdin.end();
    } catch (err) {
      if (!resolved) {
        cleanup();
        resolve(null);
      }
    }
  });
}

/**
 * Modular reranking pipeline: reorders candidates based on query relevance
 * while preserving all provenance, source metadata, and security boundaries.
 */
export async function rerankCandidates(
  query: string,
  candidates: HybridSearchResultItem[],
  options: RerankOptions = {}
): Promise<RerankResult> {
  const start = Date.now();
  const modelId = options.modelId || DEFAULT_RERANKER_MODEL;
  const topK = options.topK ? Math.min(Math.max(1, options.topK), candidates.length) : candidates.length;
  const strategy = options.strategy || 'auto';
  const minRelevanceScore = options.minRelevanceScore ?? 0.0;

  if (!candidates || candidates.length === 0) {
    return {
      modelId,
      strategyUsed: 'heuristic',
      timingMs: Date.now() - start,
      totalCandidates: 0,
      results: [],
    };
  }

  let scores: number[] | null = null;
  let strategyUsed: 'cross-encoder' | 'heuristic' = 'heuristic';

  // 1. If cross-encoder requested or auto, attempt local model inference
  if (strategy === 'cross-encoder' || strategy === 'auto') {
    const candidateTexts = candidates.map((c) => c.content);
    scores = await scorePairsWithPython(query, candidateTexts, modelId, options.timeoutMs ?? 3500);
    if (scores && scores.length === candidates.length) {
      strategyUsed = 'cross-encoder';
    }
  }

  // 2. Fallback to Heuristic Cross-Scorer if cross-encoder inference failed or not requested
  if (!scores || scores.length !== candidates.length) {
    scores = candidates.map((c) => scoreHeuristicCross(query, c.content));
    strategyUsed = 'heuristic';
  }

  // 3. Annotate candidates with rerankScore while strictly preserving all original fields
  const rerankedList: HybridSearchResultItem[] = candidates.map((item, idx) => {
    const rerankScore = scores![idx];
    return {
      ...item,
      rerankScore,
    };
  });

  // 4. Sort descending by rerankScore, with deterministic tie-breaking by original rrfScore
  rerankedList.sort((a, b) => {
    const diff = (b.rerankScore ?? 0) - (a.rerankScore ?? 0);
    if (Math.abs(diff) > 0.0001) return diff;
    return b.rrfScore - a.rrfScore;
  });

  // 5. Reassign rerankRank and slice to topK
  const filtered = rerankedList
    .filter((c) => (c.rerankScore ?? 0) >= minRelevanceScore)
    .slice(0, topK)
    .map((c, idx) => ({
      ...c,
      rankings: {
        ...c.rankings,
        rerankRank: idx + 1,
      },
    }));

  return {
    modelId,
    strategyUsed,
    timingMs: Date.now() - start,
    totalCandidates: candidates.length,
    results: filtered,
  };
}

