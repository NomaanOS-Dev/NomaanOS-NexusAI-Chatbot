/**
 * NomaanOS Nexus AI - Query Understanding Engine (Day 11)
 *
 * Implements deterministic and heuristic classification across 7 query categories,
 * conversational query rewriting, domain-aware query expansion, and multi-part query decomposition.
 */

import { logger } from '../config/logger.js';

export type QueryCategory =
  | 'greeting'
  | 'knowledge_question'
  | 'exact_lookup'
  | 'live_data'
  | 'action'
  | 'ambiguous'
  | 'unsupported';

export type RoutingTarget =
  | 'conversation'
  | 'retrieval'
  | 'exact_retrieval'
  | 'live_integration'
  | 'action_tool'
  | 'clarification'
  | 'unsupported_response';

export interface QueryClassificationResult {
  category: QueryCategory;
  confidence: number;
  reasoning: string;
  route: RoutingTarget;
  suggestedAction?: string;
  clarificationPrompt?: string;
}

export interface QueryRewritingResult {
  originalQuery: string;
  rewrittenQuery: string;
  changesMade: boolean;
  strippedPhrases: string[];
}

export interface QueryExpansionResult {
  originalQuery: string;
  expandedQuery: string;
  addedTerms: string[];
  expandedAcronyms: Record<string, string>;
}

export interface QueryDecompositionResult {
  originalQuery: string;
  isMultiPart: boolean;
  subQueries: string[];
}

export interface QueryUnderstandingResult {
  originalQuery: string;
  classification: QueryClassificationResult;
  rewriting: QueryRewritingResult;
  expansion: QueryExpansionResult;
  decomposition: QueryDecompositionResult;
}

// -------------------------------------------------------------
// Pattern Dictionaries for Query Understanding
// -------------------------------------------------------------

// Greetings & pleasantries
const GREETING_REGEX = /^(hi|hello|hey|howdy|greetings|good\s+(morning|afternoon|evening|day)|sup|yo|hiya)(\s+there|\s+nexus|\s+assistant|\s+team|[!.,\s])*$/i;

// Exact lookups: Technical error codes, endpoint paths, machine hostnames, UUIDs
const EXACT_ERROR_CODE_REGEX = /\b(ERR_[A-Z0-9_]+|RFC_[A-Z0-9_]+|HTTP_[A-Z0-9_]+|[A-Z]{3,}_ERROR_[A-Z0-9_]+)\b/;
const EXACT_API_PATH_REGEX = /(?:^|\s)(\/api\/v\d+\/[a-zA-Z0-9_\-\/]+)/;
const EXACT_NODE_HOST_REGEX = /\b([a-z0-9]+-(?:prod|staging|dev|canary|broker|worker)-\d+)\b/i;
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// Live data & telemetry inquiries
const LIVE_DATA_PATTERNS = [
  /\b(?:current|right now|live|real-time|real time|latest|currently)\b.*\b(?:status|metric|cpu|memory|load|latency|traffic|active users|connections|rps|throughput|health|uptime|price|stock|quote|ticker|market|telemetry|feed)\b/i,
  /\b(?:status|metric|cpu|memory|load|latency|traffic|active users|connections|rps|throughput|health|uptime|price|stock|quote|ticker|market|telemetry|feed)\b.*\b(?:current|right now|live|real-time|real time|latest|currently)\b/i,
  /\b(?:how many users are active right now|current cluster health|live server metrics|what is the status right now)\b/i,
  /\b(?:show|get|fetch)\s+(?:live|current|real-time)\s+(?:telemetry|metrics|logs|status|data|price|stock|feed)\b/i,
  /\b(?:live|real-time|current)\s+(?:stock\s+price|price\s+of|weather\s+in|market\s+data)\b/i,
];

// Action & mutation requests
const ACTION_PATTERNS = [
  /^(?:restart|reboot|deploy|delete|remove|create|provision|scale\s+(?:up|down)|revoke|cancel|terminate|flush|purge|trigger|execute)\b/i,
  /\b(?:please|can you|could you)?\s*(?:restart|reboot|deploy|kill|terminate|delete)\s+(?:the|this|node|service|server|pod|container|user|key)\b/i,
  /\b(?:roll back|scale up to \d+|restart cluster|flush redis cache|revoke token)\b/i,
];

// Ambiguous or underspecified queries
const AMBIGUOUS_PATTERNS = [
  /^(it\s+failed|it's\s+not\s+working|fix\s+it|what\s+happened\??|why\??|help\??|what\s+about\s+(?:that|the\s+other\s+one)\??|tell\s+me\s+more\??)$/i,
  /^\?+$/,
];

// Unsupported out-of-scope non-technical queries
const UNSUPPORTED_PATTERNS = [
  /\b(?:write|compose|generate)\s+a\s+(?:poem|story|song|joke|haiku|rap)\b/i,
  /\b(?:tell\s+me\s+a\s+joke|joke\s+about)\b/i,
  /\bwho\s+won\b.*\b(?:world\s*cup|super\s*bowl|olympics|election|match|game)\b/i,
  /\b(?:what\s+is\s+the\s+capital\s+of|recipe\s+for|weather\s+in)\b/i,
  /\b(?:movie\s+review|horoscope|celebrity\s+gossip|dating\s+advice)\b/i,
];

// Conversational filler prefixes to strip during query rewriting
const CONVERSATIONAL_FILLERS = [
  /^(?:could\s+you\s+(?:please\s+)?tell\s+me\s+(?:about\s+|how\s+to\s+|what\s+is\s+)?)/i,
  /^(?:could\s+you\s+(?:please\s+)?|can\s+you\s+(?:please\s+)?|please\s+)(?=(?:explain|describe|show|clarify|detail|tell|find|list|check|give)\b)/i,
  /^(?:can\s+you\s+(?:please\s+)?(?:explain|show|give\s+me|find)\s+(?:to\s+me\s+)?)/i,
  /^(?:i\s+(?:would\s+like|want)\s+to\s+know\s+(?:about\s+|how\s+to\s+|what\s+is\s+)?)/i,
  /^(?:i\s+was\s+wondering\s+(?:if\s+you\s+could\s+tell\s+me|how\s+to|what\s+is)\s+)/i,
  /^(?:please\s+(?:help\s+me\s+understand|explain|tell\s+me\s+about)\s+)/i,
  /^(?:do\s+you\s+know\s+(?:how\s+to|what\s+is)\s+)/i,
  /^(?:hello|hi|hey)[,!\s]+(?:can\s+you|could\s+you|please)?\s*/i,
];

// Controlled domain acronyms for safe expansion
const DOMAIN_ACRONYMS: Record<string, string> = {
  mtls: 'mutual TLS authentication',
  ttl: 'time to live expiration',
  oauth: 'OAuth2 authentication token',
  jwt: 'JSON web token claims',
  sre: 'site reliability engineering incident runbook',
  rbac: 'role based access control permissions',
  k8s: 'Kubernetes cluster pod',
  soc: 'security operations center incident',
  api: 'REST API endpoint',
  ddos: 'distributed denial of service rate limit',
  ssl: 'SSL TLS certificate handshake',
};

// -------------------------------------------------------------
// 1. Query Classification
// -------------------------------------------------------------

/**
 * Classifies a user query into one of 7 standardized categories.
 */
export function classifyQuery(rawQuery: string): QueryClassificationResult {
  const query = (rawQuery || '').trim();

  // 1. Empty or whitespace only -> ambiguous
  if (!query) {
    return {
      category: 'ambiguous',
      confidence: 1.0,
      reasoning: 'Empty or blank query provided.',
      route: 'clarification',
      clarificationPrompt: 'Please provide a question or search query.',
    };
  }

  // 2. Greetings
  if (GREETING_REGEX.test(query)) {
    return {
      category: 'greeting',
      confidence: 0.98,
      reasoning: 'Matches conversational greeting or pleasantry without question/action intent.',
      route: 'conversation',
      suggestedAction: 'Respond directly with a helpful greeting without triggering retrieval.',
    };
  }

  // 3. Ambiguous / underspecified
  if (query.length < 4 || AMBIGUOUS_PATTERNS.some((pat) => pat.test(query))) {
    return {
      category: 'ambiguous',
      confidence: 0.95,
      reasoning: 'Query is underspecified, vague, or lacks necessary context for meaningful retrieval.',
      route: 'clarification',
      clarificationPrompt: 'Could you please clarify which service, component, or error you are inquiring about?',
    };
  }

  // 4. Unsupported / Out-of-scope
  if (UNSUPPORTED_PATTERNS.some((pat) => pat.test(query))) {
    return {
      category: 'unsupported',
      confidence: 0.96,
      reasoning: 'Request pertains to general knowledge, creative writing, or non-technical domains outside platform documentation.',
      route: 'unsupported_response',
      suggestedAction: 'Inform the user respectfully that this assistant is scoped to NomaanOS technical documentation and engineering runbooks.',
    };
  }

  // 5. Actions / Operations
  if (ACTION_PATTERNS.some((pat) => pat.test(query))) {
    return {
      category: 'action',
      confidence: 0.92,
      reasoning: 'Request commands an operational mutation or state change requiring authorization and confirmation.',
      route: 'action_tool',
      suggestedAction: 'Present an action plan requiring explicit confirmation and authorization check.',
    };
  }

  // 6. Live data / Real-time telemetry
  if (LIVE_DATA_PATTERNS.some((pat) => pat.test(query))) {
    return {
      category: 'live_data',
      confidence: 0.94,
      reasoning: 'Request seeks dynamic live telemetry or real-time system metrics requiring live integration connectors.',
      route: 'live_integration',
      suggestedAction: 'Route to active telemetry integration or state that live connector permissions are required; do not fabricate numbers.',
    };
  }

  // 7. Exact technical lookups
  if (
    EXACT_ERROR_CODE_REGEX.test(query) ||
    EXACT_API_PATH_REGEX.test(query) ||
    EXACT_NODE_HOST_REGEX.test(query) ||
    UUID_REGEX.test(query)
  ) {
    return {
      category: 'exact_lookup',
      confidence: 0.95,
      reasoning: 'Contains specific technical identifier, exact error code, machine hostname, or API endpoint path.',
      route: 'exact_retrieval',
      suggestedAction: 'Execute full-text keyword search prioritizing exact token matching.',
    };
  }

  // 8. Knowledge Question (Default for technical documentation inquiries)
  return {
    category: 'knowledge_question',
    confidence: 0.90,
    reasoning: 'Standard technical or documentation inquiry suitable for hybrid retrieval.',
    route: 'retrieval',
    suggestedAction: 'Execute hybrid retrieval over authorized knowledge spaces.',
  };
}

// -------------------------------------------------------------
// 2. Query Rewriting
// -------------------------------------------------------------

/**
 * Rewrites conversational or unclear queries into search-optimized technical queries,
 * while preserving the original query for context and answer generation.
 */
export function rewriteQuery(rawQuery: string): QueryRewritingResult {
  const originalQuery = (rawQuery || '').trim();
  let rewritten = originalQuery;
  const strippedPhrases: string[] = [];

  for (const filler of CONVERSATIONAL_FILLERS) {
    const match = rewritten.match(filler);
    if (match) {
      strippedPhrases.push(match[0]);
      rewritten = rewritten.replace(filler, '').trim();
    }
  }

  // Clean trailing question marks or punctuation for search optimization
  rewritten = rewritten.replace(/[?]+$/, '').trim();

  // If rewriting collapsed the query to nothing, fallback to original
  if (rewritten.length === 0) {
    rewritten = originalQuery;
  }

  return {
    originalQuery,
    rewrittenQuery: rewritten,
    changesMade: rewritten !== originalQuery,
    strippedPhrases,
  };
}

// -------------------------------------------------------------
// 3. Query Expansion
// -------------------------------------------------------------

/**
 * Controlled query expansion for technical acronyms and domain terms.
 * Avoids uncontrolled semantic drift by relying on an explicit technical domain dictionary.
 */
export function expandQuery(rawQuery: string): QueryExpansionResult {
  const originalQuery = (rawQuery || '').trim();
  const addedTerms: string[] = [];
  const expandedAcronyms: Record<string, string> = {};

  const words = originalQuery.toLowerCase().split(/[\s,.;:!?()\/]+/);
  const existingWordSet = new Set(words);
  const expansionsToAppend: string[] = [];

  for (const word of words) {
    if (DOMAIN_ACRONYMS[word]) {
      const expansion = DOMAIN_ACRONYMS[word];
      expandedAcronyms[word] = expansion;

      // Add words from expansion that are not already present as distinct tokens
      const expansionWords = expansion.split(/\s+/);
      for (const ew of expansionWords) {
        if (!existingWordSet.has(ew.toLowerCase()) && !addedTerms.includes(ew)) {
          addedTerms.push(ew);
          expansionsToAppend.push(ew);
        }
      }
    }
  }

  const expandedQuery = expansionsToAppend.length > 0
    ? `${originalQuery} ${expansionsToAppend.join(' ')}`
    : originalQuery;

  return {
    originalQuery,
    expandedQuery,
    addedTerms,
    expandedAcronyms,
  };
}

// -------------------------------------------------------------
// 4. Query Decomposition
// -------------------------------------------------------------

/**
 * Identifies multi-part questions and decomposes them into distinct sub-questions
 * while preserving original intent.
 */
export function decomposeQuery(rawQuery: string): QueryDecompositionResult {
  const originalQuery = (rawQuery || '').trim();

  // Check for multi-part indicators using lookaheads so question words are not consumed:
  // e.g., "How do I configure OAuth AND what is the error code when it expires?"
  // e.g., "Where is node-prod-42 located? Also, how do I trigger failover?"
  const splitRegex = /\s*(?:;\s*|\band\s+(?=(?:how|what|where|why|can|is|does)\b)|\balso\s+(?=(?:how|what|where|why|can|is|does)\b)|\badditionally\b|\bas\s+well\s+as\b|\?\s+(?=[A-Z0-9]))/i;

  const rawParts = originalQuery.split(splitRegex);
  const subQueries = rawParts
    .map((p) => p.replace(/[?]+$/, '').trim())
    .filter((p) => p.length >= 6); // Filter out tiny fragments

  const isMultiPart = subQueries.length > 1;

  return {
    originalQuery,
    isMultiPart,
    subQueries: isMultiPart ? subQueries : [originalQuery],
  };
}

// -------------------------------------------------------------
// 5. Unified Query Analysis
// -------------------------------------------------------------

/**
 * Runs classification, rewriting, expansion, and decomposition in a single pipeline.
 */
export function analyzeQuery(rawQuery: string): QueryUnderstandingResult {
  const classification = classifyQuery(rawQuery);
  const rewriting = rewriteQuery(rawQuery);
  const expansion = expandQuery(rewriting.rewrittenQuery);
  const decomposition = decomposeQuery(rawQuery);

  return {
    originalQuery: rawQuery,
    classification,
    rewriting,
    expansion,
    decomposition,
  };
}
