/**
 * NomaanOS Nexus AI - Reciprocal Rank Fusion (RRF) Service (Day 10)
 *
 * Implements standard Reciprocal Rank Fusion (RRF) to merge, rank, and deduplicate
 * results from multiple heterogeneous retrieval systems (e.g., semantic vector
 * and full-text keyword retrieval).
 *
 * Formula:
 *   RRF_Score(d) = \sum_{m \in M} \frac{w_m}{k + r_m(d)}
 *
 * where:
 *   - k is the ranking smoothing constant (default: 60)
 *   - r_m(d) is the 1-based rank position of chunk d in method m
 *   - w_m is the importance weight of method m (default: 1.0)
 */

export interface RankedSourceItem {
  chunkId: string;
  content: string;
  source: {
    id: string;
    title: string;
    filename: string;
    versionNumber: number;
    sha256?: string;
  };
  provenance: {
    sectionPath: string | null;
    pageNumber: number | null;
    sourceOffset: number | null;
    chunkIndex: number;
  };
  tokenCount: number;
  metadata: Record<string, any>;
  score?: number;
}

export interface SemanticSearchResultItem extends RankedSourceItem {
  similarityScore: number;
}

export interface KeywordSearchResultItem extends RankedSourceItem {
  keywordScore: number;
}

export interface HybridSearchResultItem {
  chunkId: string;
  content: string;
  rrfScore: number;
  similarityScore: number | null;
  keywordScore: number | null;
  rerankScore?: number;
  rankings: {
    rrfRank: number;
    semanticRank: number | null;
    keywordRank: number | null;
    rerankRank?: number | null;
  };
  source: {
    id: string;
    title: string;
    filename: string;
    versionNumber: number;
    sha256?: string;
  };
  provenance: {
    sectionPath: string | null;
    pageNumber: number | null;
    sourceOffset: number | null;
    chunkIndex: number;
  };
  tokenCount: number;
  metadata: Record<string, any>;
}

export interface RRFOptions {
  k?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  topK?: number;
}

/**
 * Merges two ranked lists (semantic and keyword) using Reciprocal Rank Fusion.
 * Deduplicates results so each chunk appears at most once in the final list.
 */
export function reciprocalRankFusion(
  semanticResults: SemanticSearchResultItem[],
  keywordResults: KeywordSearchResultItem[],
  options?: RRFOptions
): HybridSearchResultItem[] {
  const k = Math.max(1, options?.k ?? 60);
  const semanticWeight = Math.max(0, options?.semanticWeight ?? 1.0);
  const keywordWeight = Math.max(0, options?.keywordWeight ?? 1.0);
  const topK = options?.topK !== undefined ? Math.max(1, options.topK) : undefined;

  interface MergedCandidate {
    chunkId: string;
    content: string;
    source: RankedSourceItem['source'];
    provenance: RankedSourceItem['provenance'];
    tokenCount: number;
    metadata: Record<string, any>;
    semanticRank: number | null;
    keywordRank: number | null;
    similarityScore: number | null;
    keywordScore: number | null;
    rrfScore: number;
  }

  const map = new Map<string, MergedCandidate>();

  // 1. Process Semantic Results
  for (let i = 0; i < semanticResults.length; i++) {
    const item = semanticResults[i];
    const rank = i + 1; // 1-based rank
    const contribution = semanticWeight / (k + rank);

    map.set(item.chunkId, {
      chunkId: item.chunkId,
      content: item.content,
      source: item.source,
      provenance: item.provenance,
      tokenCount: item.tokenCount,
      metadata: item.metadata || {},
      semanticRank: rank,
      keywordRank: null,
      similarityScore: item.similarityScore,
      keywordScore: null,
      rrfScore: contribution,
    });
  }

  // 2. Process Keyword Results
  for (let j = 0; j < keywordResults.length; j++) {
    const item = keywordResults[j];
    const rank = j + 1; // 1-based rank
    const contribution = keywordWeight / (k + rank);

    const existing = map.get(item.chunkId);
    if (existing) {
      existing.keywordRank = rank;
      existing.keywordScore = item.keywordScore;
      existing.rrfScore += contribution;
    } else {
      map.set(item.chunkId, {
        chunkId: item.chunkId,
        content: item.content,
        source: item.source,
        provenance: item.provenance,
        tokenCount: item.tokenCount,
        metadata: item.metadata || {},
        semanticRank: null,
        keywordRank: rank,
        similarityScore: null,
        keywordScore: item.keywordScore,
        rrfScore: contribution,
      });
    }
  }

  // 3. Sort candidates by RRF score descending, breaking ties deterministically
  const candidates = Array.from(map.values());
  candidates.sort((a, b) => {
    if (Math.abs(b.rrfScore - a.rrfScore) > 1e-9) {
      return b.rrfScore - a.rrfScore;
    }
    // Tie-break 1: highest semantic score
    if ((b.similarityScore ?? -1) !== (a.similarityScore ?? -1)) {
      return (b.similarityScore ?? -1) - (a.similarityScore ?? -1);
    }
    // Tie-break 2: highest keyword score
    if ((b.keywordScore ?? -1) !== (a.keywordScore ?? -1)) {
      return (b.keywordScore ?? -1) - (a.keywordScore ?? -1);
    }
    // Tie-break 3: chunkId alphanumeric
    return a.chunkId.localeCompare(b.chunkId);
  });

  // 4. Assign 1-based rrfRank and format output
  const results: HybridSearchResultItem[] = candidates.map((c, index) => ({
    chunkId: c.chunkId,
    content: c.content,
    rrfScore: Math.round(c.rrfScore * 1000000) / 1000000,
    similarityScore: c.similarityScore,
    keywordScore: c.keywordScore,
    rankings: {
      rrfRank: index + 1,
      semanticRank: c.semanticRank,
      keywordRank: c.keywordRank,
    },
    source: c.source,
    provenance: c.provenance,
    tokenCount: c.tokenCount,
    metadata: c.metadata,
  }));

  if (topK !== undefined) {
    return results.slice(0, topK);
  }

  return results;
}

