/**
 * NomaanOS Nexus AI - Hybrid Retrieval Pipeline (Day 10)
 *
 * Combines semantic vector search (pgvector HNSW) and PostgreSQL full-text search
 * using Reciprocal Rank Fusion (RRF). Supports keyword-only, semantic-only,
 * and hybrid retrieval modes with metadata/product filters and strict tenant scoping.
 */

import { logger } from '../config/logger.js';
import { searchKnowledgeSpace, VectorSearchOptions, VectorSearchError } from './vector-search.js';
import { searchKeywordKnowledgeSpace, KeywordSearchOptions, KeywordSearchError, SearchFilters } from './keyword-search.js';
import { reciprocalRankFusion, HybridSearchResultItem } from './rrf.js';
import { rerankCandidates, RerankResult } from './reranker.js';

export type SearchMode = 'hybrid' | 'semantic' | 'keyword';

export interface HybridSearchOptions {
  workspaceId: string;
  knowledgeSpaceId: string;
  query: string;
  searchMode?: SearchMode;
  topK?: number;
  minSimilarity?: number;
  minScore?: number;
  rrfK?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  modelId?: string;
  filters?: SearchFilters;
  rerank?: boolean;
  rerankerModel?: string;
  rerankTopK?: number;
}

export interface HybridSearchResponse {
  query: string;
  searchMode: SearchMode;
  totalResults: number;
  totalCount: number; // Backward compatibility alias
  model?: {
    id: string;
    modelId: string;
    dimensions: number;
    distanceMetric: string;
  };
  reranker?: {
    modelId: string;
    strategy: string;
  };
  rerankApplied?: boolean;
  timingsMs: {
    semantic?: number;
    keyword?: number;
    fusion?: number;
    rerank?: number;
    total: number;
  };
  results: HybridSearchResultItem[];
}

export class HybridSearchError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'HybridSearchError';
    this.statusCode = statusCode;
  }
}

/**
 * Executes hybrid, semantic-only, or keyword-only retrieval over a knowledge space.
 */
export async function searchHybridKnowledgeSpace(
  options: HybridSearchOptions
): Promise<HybridSearchResponse> {
  const overallStart = Date.now();
  const searchMode: SearchMode = options.searchMode ?? 'hybrid';
  const topK = Math.min(Math.max(1, options.topK ?? 5), 50);

  if (!options.query || typeof options.query !== 'string' || options.query.trim().length === 0) {
    throw new HybridSearchError('Search query must be a non-empty string.', 400);
  }

  if (options.query.length > 2000) {
    throw new HybridSearchError('Search query exceeds maximum allowed length of 2000 characters.', 400);
  }

  // 1. Semantic-Only Mode
  if (searchMode === 'semantic') {
    try {
      const vectorRes = await searchKnowledgeSpace({
        workspaceId: options.workspaceId,
        knowledgeSpaceId: options.knowledgeSpaceId,
        query: options.query,
        topK,
        minScore: options.minSimilarity ?? options.minScore ?? 0.0,
        modelId: options.modelId,
        filters: options.filters,
      });

      const formattedResults: HybridSearchResultItem[] = vectorRes.results.map((r, idx) => ({
        chunkId: r.chunkId,
        content: r.content,
        rrfScore: r.similarityScore,
        similarityScore: r.similarityScore,
        keywordScore: null,
        rankings: {
          rrfRank: idx + 1,
          semanticRank: idx + 1,
          keywordRank: null,
        },
        source: r.source,
        provenance: r.provenance,
        tokenCount: r.tokenCount,
        metadata: r.metadata,
      }));

      const totalTime = Date.now() - overallStart;
      return {
        query: options.query,
        searchMode: 'semantic',
        totalResults: formattedResults.length,
        totalCount: formattedResults.length,
        model: vectorRes.model,
        timingsMs: {
          semantic: vectorRes.timingsMs.total,
          total: totalTime,
        },
        results: formattedResults,
      };
    } catch (err: any) {
      if (err instanceof VectorSearchError) {
        throw new HybridSearchError(err.message, err.statusCode);
      }
      throw err;
    }
  }

  // 2. Keyword-Only Mode
  if (searchMode === 'keyword') {
    try {
      const kwRes = await searchKeywordKnowledgeSpace({
        workspaceId: options.workspaceId,
        knowledgeSpaceId: options.knowledgeSpaceId,
        query: options.query,
        topK,
        minScore: options.minScore ?? 0.0,
        filters: options.filters,
      });

      const formattedResults: HybridSearchResultItem[] = kwRes.results.map((r, idx) => ({
        chunkId: r.chunkId,
        content: r.content,
        rrfScore: r.keywordScore,
        similarityScore: null,
        keywordScore: r.keywordScore,
        rankings: {
          rrfRank: idx + 1,
          semanticRank: null,
          keywordRank: idx + 1,
        },
        source: r.source,
        provenance: r.provenance,
        tokenCount: r.tokenCount,
        metadata: r.metadata,
      }));

      const totalTime = Date.now() - overallStart;
      return {
        query: options.query,
        searchMode: 'keyword',
        totalResults: formattedResults.length,
        totalCount: formattedResults.length,
        timingsMs: {
          keyword: kwRes.timingMs,
          total: totalTime,
        },
        results: formattedResults,
      };
    } catch (err: any) {
      if (err instanceof KeywordSearchError) {
        throw new HybridSearchError(err.message, err.statusCode);
      }
      throw err;
    }
  }

  // 3. Hybrid Mode (Semantic + Keyword + RRF)
  try {
    const fetchTopK = Math.min(topK * 3, 50); // Fetch top 3x candidates for fusion

    const [vectorRes, kwRes] = await Promise.all([
      searchKnowledgeSpace({
        workspaceId: options.workspaceId,
        knowledgeSpaceId: options.knowledgeSpaceId,
        query: options.query,
        topK: fetchTopK,
        minScore: options.minSimilarity ?? options.minScore ?? 0.0,
        modelId: options.modelId,
        filters: options.filters,
      }),
      searchKeywordKnowledgeSpace({
        workspaceId: options.workspaceId,
        knowledgeSpaceId: options.knowledgeSpaceId,
        query: options.query,
        topK: fetchTopK,
        minScore: options.minScore ?? 0.0,
        filters: options.filters,
      }),
    ]);

    const fusionStart = Date.now();
    const candidateLimit = options.rerank ? Math.max(topK * 3, 15) : topK;
    const fusedResults = reciprocalRankFusion(
      vectorRes.results,
      kwRes.results,
      {
        k: options.rrfK ?? 60,
        semanticWeight: options.semanticWeight ?? 1.0,
        keywordWeight: options.keywordWeight ?? 1.0,
        topK: candidateLimit,
      }
    );
    const fusionTime = Date.now() - fusionStart;

    let finalResults = fusedResults.slice(0, topK);
    let rerankTiming: number | undefined;
    let rerankerMeta: { modelId: string; strategy: string } | undefined;

    if (options.rerank && fusedResults.length > 0) {
      const rerankRes = await rerankCandidates(options.query, fusedResults, {
        modelId: options.rerankerModel,
        topK: options.rerankTopK ?? topK,
      });
      finalResults = rerankRes.results;
      rerankTiming = rerankRes.timingMs;
      rerankerMeta = {
        modelId: rerankRes.modelId,
        strategy: rerankRes.strategyUsed,
      };
    }

    const totalTime = Date.now() - overallStart;

    logger.info(
      {
        workspaceId: options.workspaceId,
        knowledgeSpaceId: options.knowledgeSpaceId,
        semanticCount: vectorRes.results.length,
        keywordCount: kwRes.results.length,
        fusedCount: fusedResults.length,
        finalCount: finalResults.length,
        reranked: Boolean(options.rerank),
        totalTime,
      },
      'Executed hybrid retrieval'
    );

    return {
      query: options.query,
      searchMode: 'hybrid',
      totalResults: finalResults.length,
      totalCount: finalResults.length,
      model: vectorRes.model,
      reranker: rerankerMeta,
      rerankApplied: Boolean(options.rerank && rerankerMeta),
      timingsMs: {
        semantic: vectorRes.timingsMs.total,
        keyword: kwRes.timingMs,
        fusion: fusionTime,
        rerank: rerankTiming,
        total: totalTime,
      },
      results: finalResults,
    };
  } catch (err: any) {
    if (err instanceof VectorSearchError || err instanceof KeywordSearchError) {
      throw new HybridSearchError(err.message, err.statusCode);
    }
    throw err;
  }
}
