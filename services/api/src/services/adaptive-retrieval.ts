/**
 * NomaanOS Nexus AI - Adaptive Retrieval Pipeline (Day 11)
 *
 * Combines query understanding (classification, rewriting, expansion, decomposition)
 * with the Day 10 hybrid-search pipeline. Implements bounded retries for insufficient
 * initial results, multi-part sub-query fusion, and strict tenant security.
 */

import { logger } from '../config/logger.js';
import {
  searchHybridKnowledgeSpace,
  HybridSearchResponse,
  SearchMode,
} from './hybrid-search.js';
import { SearchFilters } from './keyword-search.js';
import {
  analyzeQuery,
  QueryUnderstandingResult,
  QueryClassificationResult,
} from './query-understanding.js';
import { reciprocalRankFusion, HybridSearchResultItem } from './rrf.js';

export interface AdaptiveRetrievalOptions {
  workspaceId: string;
  knowledgeSpaceId: string;
  query: string;
  searchMode?: SearchMode;
  topK?: number;
  minScore?: number;
  minSimilarity?: number;
  rrfK?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  modelId?: string;
  filters?: SearchFilters;
  maxRetries?: number;
}

export interface RoutingAdvice {
  target: string;
  message?: string;
  requiresLiveIntegration?: boolean;
  requiresConfirmation?: boolean;
}

export interface AdaptiveRetrievalResponse {
  query: string;
  originalQuery: string;
  classification: QueryClassificationResult;
  rewrittenQuery?: string;
  expandedQuery?: string;
  isMultiPart: boolean;
  subQueries: string[];
  searchMode: SearchMode;
  attempts: number;
  retried: boolean;
  retryReason?: string;
  insufficientEvidence: boolean;
  totalResults: number;
  totalCount: number; // Backward compatibility alias
  model?: {
    id: string;
    modelId: string;
    dimensions: number;
    distanceMetric: string;
  };
  timingsMs: {
    understanding: number;
    retrieval: number;
    total: number;
  };
  routingAdvice?: RoutingAdvice;
  results: HybridSearchResultItem[];
}

export class AdaptiveRetrievalError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AdaptiveRetrievalError';
    this.statusCode = statusCode;
  }
}

/**
 * Executes adaptive retrieval over a knowledge space, handling query understanding,
 * non-retrieval fast-paths, multi-part decomposition, and bounded retries.
 */
export async function adaptiveRetrieve(
  options: AdaptiveRetrievalOptions
): Promise<AdaptiveRetrievalResponse> {
  const overallStart = Date.now();

  if (!options.query || typeof options.query !== 'string' || options.query.trim().length === 0) {
    throw new AdaptiveRetrievalError('Search query must be a non-empty string.', 400);
  }

  const topK = Math.min(Math.max(1, options.topK ?? 5), 50);
  const maxRetries = Math.min(Math.max(0, options.maxRetries ?? 1), 2); // Max 1 retry (2 total attempts)
  const defaultMode: SearchMode = options.searchMode ?? 'hybrid';

  // 1. Query Understanding & Analysis
  const understandingStart = Date.now();
  const analysis: QueryUnderstandingResult = analyzeQuery(options.query);
  const understandingTime = Date.now() - understandingStart;

  const { classification, rewriting, expansion, decomposition } = analysis;

  // 2. Early-Exit Routing for Non-Retrieval Requests
  if (['greeting', 'ambiguous', 'unsupported', 'live_data', 'action'].includes(classification.category)) {
    let routingAdvice: RoutingAdvice;

    switch (classification.category) {
      case 'greeting':
        routingAdvice = {
          target: 'conversation',
          message: 'Hello! I am your NomaanOS Nexus AI assistant. How can I assist you with platform documentation or runbooks today?',
        };
        break;
      case 'ambiguous':
        routingAdvice = {
          target: 'clarification',
          message: classification.clarificationPrompt || 'Could you please provide more context or specify which system you are asking about?',
        };
        break;
      case 'unsupported':
        routingAdvice = {
          target: 'unsupported_response',
          message: 'This question appears to be outside of the technical documentation and runbook scope of NomaanOS Nexus AI.',
        };
        break;
      case 'live_data':
        routingAdvice = {
          target: 'live_integration',
          message: 'Live telemetry and real-time operational status require an authorized live integration connector. Live metrics cannot be generated from static documentation.',
          requiresLiveIntegration: true,
        };
        break;
      case 'action':
        routingAdvice = {
          target: 'action_tool',
          message: 'Action requests require explicit user confirmation and authorized tool permissions before execution.',
          requiresConfirmation: true,
        };
        break;
      default:
        routingAdvice = { target: 'conversation' };
    }

    return {
      query: options.query,
      originalQuery: options.query,
      classification,
      rewrittenQuery: rewriting.rewrittenQuery,
      expandedQuery: expansion.expandedQuery,
      isMultiPart: decomposition.isMultiPart,
      subQueries: decomposition.subQueries,
      searchMode: defaultMode,
      attempts: 0,
      retried: false,
      insufficientEvidence: false,
      totalResults: 0,
      totalCount: 0,
      timingsMs: {
        understanding: understandingTime,
        retrieval: 0,
        total: Date.now() - overallStart,
      },
      routingAdvice,
      results: [],
    };
  }

  // 3. Retrieval Execution (Exact Lookup or Knowledge Question)
  let attempts = 0;
  let retried = false;
  let retryReason: string | undefined;
  let finalResults: HybridSearchResultItem[] = [];
  let resolvedModel: any = undefined;

  const retrievalStart = Date.now();

  // Helper to execute search for a single query string
  const executeSearch = async (
    queryStr: string,
    mode: SearchMode,
    limit: number,
    minScore?: number
  ): Promise<HybridSearchResponse> => {
    return searchHybridKnowledgeSpace({
      workspaceId: options.workspaceId,
      knowledgeSpaceId: options.knowledgeSpaceId,
      query: queryStr,
      searchMode: mode,
      topK: limit,
      minScore: minScore ?? options.minScore,
      minSimilarity: minScore ?? options.minSimilarity,
      rrfK: options.rrfK,
      semanticWeight: options.semanticWeight,
      keywordWeight: options.keywordWeight,
      modelId: options.modelId,
      filters: options.filters,
    });
  };

  // Decide initial search mode & query
  let currentMode: SearchMode = defaultMode;
  if (classification.category === 'exact_lookup') {
    // For exact technical lookups, start with keyword or hybrid
    currentMode = defaultMode === 'semantic' ? 'hybrid' : defaultMode;
  }

  // Handle Multi-Part Decomposition
  if (decomposition.isMultiPart) {
    attempts++;
    const fullQuery = rewriting.changesMade ? rewriting.rewrittenQuery : options.query;
    const queriesToSearch = [
      fullQuery,
      ...decomposition.subQueries.filter((sq) => sq.toLowerCase().trim() !== fullQuery.toLowerCase().trim())
    ];

    const subQueryResponses = await Promise.all(
      queriesToSearch.map((subQ) => executeSearch(subQ, currentMode, topK))
    );

    // Merge multi-part results: Collect all results from sub-queries and combine them via RRF
    const allCandidates: HybridSearchResultItem[] = [];
    for (const subRes of subQueryResponses) {
      if (!resolvedModel && subRes.model) {
        resolvedModel = subRes.model;
      }
      allCandidates.push(...subRes.results);
    }

    // Deduplicate and re-rank merged candidates
    finalResults = deduplicateAndRank(allCandidates, topK);
  } else {
    // Single-Part Query: Use rewritten query for initial attempt
    attempts++;
    const initialQuery = rewriting.changesMade ? rewriting.rewrittenQuery : options.query;
    const initialResponse = await executeSearch(initialQuery, currentMode, topK);
    resolvedModel = initialResponse.model;
    finalResults = initialResponse.results;
  }

  // 4. Evaluate Sufficiency & Bounded Retries
  const topResult = finalResults[0];
  const hasStrongKeyword = (topResult?.keywordScore ?? 0) > 0.01;
  const hasStrongSemantic = (topResult?.similarityScore ?? 0) >= (options.minSimilarity ?? options.minScore ?? 0.55);
  const isSufficient = finalResults.length > 0 && (hasStrongKeyword || hasStrongSemantic);

  if (!isSufficient && attempts <= maxRetries) {
    attempts++;
    retried = true;
    retryReason = 'initial_results_insufficient';

    // Retry Strategy:
    // Try expanded query with 'hybrid' mode
    const retryQuery = expansion.expandedQuery !== options.query ? expansion.expandedQuery : options.query;
    const retryMode: SearchMode = 'hybrid';

    const retryResponse = await executeSearch(retryQuery, retryMode, topK, 0.0);
    const retryTop = retryResponse.results[0];
    const retryHasKeyword = (retryTop?.keywordScore ?? 0) > 0.01;
    const retryHasSemantic = (retryTop?.similarityScore ?? 0) >= 0.55;

    if (retryResponse.results.length > 0 && (retryHasKeyword || retryHasSemantic)) {
      finalResults = retryResponse.results;
      if (!resolvedModel && retryResponse.model) {
        resolvedModel = retryResponse.model;
      }
    } else {
      // If retry still produced no valid evidence, mark as insufficient evidence
      finalResults = [];
    }
  }

  const retrievalTime = Date.now() - retrievalStart;
  const insufficientEvidence = finalResults.length === 0;

  return {
    query: rewriting.rewrittenQuery,
    originalQuery: options.query,
    classification,
    rewrittenQuery: rewriting.rewrittenQuery,
    expandedQuery: expansion.expandedQuery,
    isMultiPart: decomposition.isMultiPart,
    subQueries: decomposition.subQueries,
    searchMode: currentMode,
    attempts,
    retried,
    retryReason,
    insufficientEvidence,
    totalResults: finalResults.length,
    totalCount: finalResults.length,
    model: resolvedModel,
    timingsMs: {
      understanding: understandingTime,
      retrieval: retrievalTime,
      total: Date.now() - overallStart,
    },
    routingAdvice: insufficientEvidence
      ? {
          target: 'insufficient_evidence',
          message: 'No relevant documentation was found matching this query in the specified knowledge space.',
        }
      : {
          target: 'retrieval',
          message: 'Successfully retrieved relevant documentation chunks.',
        },
    results: finalResults.slice(0, topK),
  };
}

/**
 * Deduplicates and ranks merged results across sub-queries.
 */
function deduplicateAndRank(
  items: HybridSearchResultItem[],
  limit: number
): HybridSearchResultItem[] {
  const map = new Map<string, HybridSearchResultItem>();

  for (const item of items) {
    const existing = map.get(item.chunkId);
    if (!existing) {
      map.set(item.chunkId, { ...item });
    } else {
      // Accumulate score for multi-query matching
      existing.rrfScore += item.rrfScore;
      if (item.similarityScore && (!existing.similarityScore || item.similarityScore > existing.similarityScore)) {
        existing.similarityScore = item.similarityScore;
      }
      if (item.keywordScore && (!existing.keywordScore || item.keywordScore > existing.keywordScore)) {
        existing.keywordScore = item.keywordScore;
      }
    }
  }

  const sorted = Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);

  return sorted.slice(0, limit).map((r, idx) => ({
    ...r,
    rankings: {
      ...r.rankings,
      rrfRank: idx + 1,
    },
  }));
}
