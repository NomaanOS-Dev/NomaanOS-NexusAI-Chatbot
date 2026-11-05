/**
 * NomaanOS Nexus AI - Evidence Assembly & Context Budgeting Service (Day 13)
 *
 * Collects retrieved and reranked candidate chunks, performs deduplication and
 * substantial overlap suppression, revalidates workspace/tenant/version permissions
 * in PostgreSQL (defense in depth), and enforces context window and token budget constraints.
 */

import crypto from 'node:crypto';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';
import { HybridSearchResultItem } from './rrf.js';

export interface EvidenceCandidate {
  chunkId: string;
  content: string;
  source: {
    id: string;
    title: string;
    filename?: string;
    versionNumber?: number;
    sha256?: string;
  };
  provenance?: {
    sectionPath?: string | null;
    pageNumber?: number | null;
    sourceOffset?: number | null;
    chunkIndex?: number;
  };
  tokenCount?: number;
  score?: number;
  relevanceScore?: number;
  similarityScore?: number | null;
  keywordScore?: number | null;
  rrfScore?: number;
  rerankScore?: number;
  metadata?: Record<string, any>;
}

export interface AssembledEvidenceItem {
  citationIndex: number;
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  filename: string;
  versionNumber: number;
  sectionPath: string | null;
  pageNumber: number | null;
  sourceOffset: number | null;
  tokenCount: number;
  relevanceScore: number;
  content: string;
  truncated: boolean;
}

export interface AssembleEvidenceResult {
  items: AssembledEvidenceItem[];
  totalTokens: number;
  totalChunks: number;
  candidateCount: number;
  deduplicatedCount: number;
  excludedPermissionCount: number;
  insufficientEvidence: boolean;
  reason?: string;
}

export interface AssembleEvidenceOptions {
  candidates: EvidenceCandidate[];
  workspaceId: string;
  knowledgeSpaceId?: string;
  maxTokens?: number;
  maxChunks?: number;
  minScore?: number;
  skipPermissionValidation?: boolean;
  customPool?: any;
}

/**
 * Extracts normalized relevance score from candidate.
 */
export function getCandidateScore(c: EvidenceCandidate): number {
  if (typeof c.rerankScore === 'number') return c.rerankScore;
  if (typeof c.relevanceScore === 'number') return c.relevanceScore;
  if (typeof c.rrfScore === 'number') return c.rrfScore * 60; // Normalized RRF score
  if (typeof c.score === 'number') return c.score;
  if (typeof c.similarityScore === 'number' && c.similarityScore !== null) return c.similarityScore;
  if (typeof c.keywordScore === 'number' && c.keywordScore !== null) return c.keywordScore;
  return 0.0;
}

/**
 * Checks whether two texts are identical or exhibit substantial substring / token overlap (default >= 85%).
 */
export function isSubstantialOverlap(textA: string, textB: string, threshold = 0.85): boolean {
  if (!textA || !textB) return false;
  const normA = textA.toLowerCase().replace(/\s+/g, ' ').trim();
  const normB = textB.toLowerCase().replace(/\s+/g, ' ').trim();

  if (normA === normB) return true;
  if (normA.length === 0 || normB.length === 0) return false;

  const minLen = Math.min(normA.length, normB.length);
  const maxLen = Math.max(normA.length, normB.length);

  // Substring containment check
  if (normA.includes(normB) || normB.includes(normA)) {
    if (minLen / maxLen >= threshold) return true;
  }

  // Token-level containment check
  const wordsA = normA.split(' ').filter((w) => w.length > 2);
  const wordsB = normB.split(' ').filter((w) => w.length > 2);

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const setB = new Set(wordsB);
  let matchCount = 0;
  for (const w of wordsA) {
    if (setB.has(w)) matchCount++;
  }

  const minWords = Math.min(wordsA.length, wordsB.length);
  if (minWords > 0 && matchCount / minWords >= threshold) {
    return true;
  }

  return false;
}

/**
 * Removes duplicate candidates by chunkId, content hash, identical normalized text,
 * or substantial substring overlap. Preserves the candidate with higher relevance score.
 */
export function deduplicateCandidates(candidates: EvidenceCandidate[]): {
  deduplicated: EvidenceCandidate[];
  droppedCount: number;
} {
  if (!candidates || candidates.length <= 1) {
    return { deduplicated: candidates ? [...candidates] : [], droppedCount: 0 };
  }

  // Sort candidate copies by score descending
  const sorted = [...candidates].sort((a, b) => getCandidateScore(b) - getCandidateScore(a));
  const retained: EvidenceCandidate[] = [];
  const seenChunkIds = new Set<string>();
  const seenContentHashes = new Set<string>();
  let droppedCount = 0;

  for (const cand of sorted) {
    // 1. Exact Chunk ID match
    if (cand.chunkId && seenChunkIds.has(cand.chunkId)) {
      droppedCount++;
      continue;
    }

    // 2. Exact chunk content SHA256 match (deduplicate identical chunks across different uploads/sources)
    const chunkContentHash = crypto.createHash('sha256').update(cand.content.trim()).digest('hex');
    if (seenContentHashes.has(chunkContentHash)) {
      droppedCount++;
      continue;
    }

    // 3. Normalized text / substantial overlap match against retained items
    let isDuplicate = false;
    for (const existing of retained) {
      if (isSubstantialOverlap(cand.content, existing.content, 0.85)) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      droppedCount++;
      continue;
    }

    if (cand.chunkId) seenChunkIds.add(cand.chunkId);
    seenContentHashes.add(chunkContentHash);
    retained.push(cand);
  }

  return { deduplicated: retained, droppedCount };
}

/**
 * Revalidates chunk permissions directly in PostgreSQL.
 * Defense-in-depth: Re-checks that each chunk exists, belongs to the tenant's workspace
 * (and optional knowledge space), belongs to an active document source, and is from an
 * active, current (non-superseded) document version.
 */
export async function validateChunkPermissions(
  chunkIds: string[],
  workspaceId: string,
  knowledgeSpaceId?: string,
  clientPool = pool
): Promise<Set<string>> {
  if (!chunkIds || chunkIds.length === 0) {
    return new Set<string>();
  }

  try {
    const query = `
      SELECT dc.id AS chunk_id
      FROM document_chunks dc
      JOIN document_sources ds ON dc.source_id = ds.id
      JOIN document_versions dv ON dc.version_id = dv.id
      WHERE dc.id = ANY($1::uuid[])
        AND dc.workspace_id = $2::uuid
        AND ds.workspace_id = $2::uuid
        ${knowledgeSpaceId ? 'AND dc.knowledge_space_id = $3::uuid' : ''}
        AND dc.is_active = TRUE
        AND ds.status NOT IN ('failed', 'error', 'archived')
        AND dv.status = 'active'
        AND (dv.is_current = TRUE OR ds.current_version_id = dv.id);
    `;

    const params: any[] = [chunkIds, workspaceId];
    if (knowledgeSpaceId) {
      params.push(knowledgeSpaceId);
    }

    const res = await clientPool.query(query, params);
    const validSet = new Set<string>();
    for (const row of res.rows) {
      validSet.add(row.chunk_id);
    }
    return validSet;
  } catch (err) {
    logger.error({ err }, 'Error during chunk permission revalidation');
    // On query failure, fail closed (return empty set)
    return new Set<string>();
  }
}

/**
 * Assembles evidence from candidate chunks:
 * 1. Deduplicates and removes overlapping passages.
 * 2. Re-validates tenant/workspace permissions directly against PostgreSQL.
 * 3. Filters candidates below minimum relevance threshold.
 * 4. Enforces context window and token budget constraints.
 * 5. Formats structured evidence items with full traceable provenance.
 */
export async function assembleEvidence(
  options: AssembleEvidenceOptions
): Promise<AssembleEvidenceResult> {
  const {
    candidates = [],
    workspaceId,
    knowledgeSpaceId,
    maxTokens = config.evidence.maxTokens,
    maxChunks = config.evidence.maxChunks,
    minScore = config.evidence.minScore,
    skipPermissionValidation = false,
    customPool = pool,
  } = options;

  if (!workspaceId) {
    throw new Error('workspaceId is required for evidence assembly');
  }

  const candidateCount = candidates.length;

  if (candidateCount === 0) {
    return {
      items: [],
      totalTokens: 0,
      totalChunks: 0,
      candidateCount: 0,
      deduplicatedCount: 0,
      excludedPermissionCount: 0,
      insufficientEvidence: true,
      reason: 'No candidate passages retrieved.',
    };
  }

  // Step 1: Deduplication
  const { deduplicated, droppedCount: deduplicatedCount } = deduplicateCandidates(candidates);

  // Step 2: Permission revalidation in DB (defense in depth)
  let permissionAuthorized: EvidenceCandidate[] = [];
  let excludedPermissionCount = 0;

  if (skipPermissionValidation) {
    permissionAuthorized = deduplicated;
  } else {
    const chunkIds = deduplicated
      .map((c) => c.chunkId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const validChunkIds = await validateChunkPermissions(
      chunkIds,
      workspaceId,
      knowledgeSpaceId,
      customPool
    );

    for (const cand of deduplicated) {
      if (cand.chunkId && validChunkIds.has(cand.chunkId)) {
        permissionAuthorized.push(cand);
      } else {
        excludedPermissionCount++;
      }
    }
  }

  // Step 3: Filter by minimum relevance score
  const qualifying = permissionAuthorized.filter((c) => getCandidateScore(c) >= minScore);

  if (qualifying.length === 0) {
    return {
      items: [],
      totalTokens: 0,
      totalChunks: 0,
      candidateCount,
      deduplicatedCount,
      excludedPermissionCount,
      insufficientEvidence: true,
      reason: 'No candidate passages met the minimum relevance threshold.',
    };
  }

  // Step 4: Enforce context-budget & token limits
  // Candidates are already sorted by relevance score descending
  const assembledItems: AssembledEvidenceItem[] = [];
  let currentTokens = 0;

  for (let i = 0; i < qualifying.length; i++) {
    if (assembledItems.length >= maxChunks) {
      break;
    }

    const cand = qualifying[i];
    const score = getCandidateScore(cand);
    const approxCandTokens =
      typeof cand.tokenCount === 'number' && cand.tokenCount > 0
        ? cand.tokenCount
        : Math.max(1, Math.ceil(cand.content.length / 4));

    const remainingBudget = maxTokens - currentTokens;

    if (remainingBudget <= 0) {
      break;
    }

    let finalContent = cand.content;
    let finalTokens = approxCandTokens;
    let truncated = false;

    if (approxCandTokens > remainingBudget) {
      // If remaining budget allows at least 40 tokens (~160 chars), partially truncate
      if (remainingBudget >= 40) {
        const allowedChars = (remainingBudget - 10) * 4;
        finalContent = cand.content.slice(0, Math.max(50, allowedChars)).trim() + '\n... [truncated to fit context budget]';
        finalTokens = remainingBudget;
        truncated = true;
      } else {
        // Not enough budget to fit a meaningful excerpt, skip
        continue;
      }
    }

    assembledItems.push({
      citationIndex: assembledItems.length + 1,
      chunkId: cand.chunkId,
      sourceId: cand.source?.id || cand.chunkId,
      sourceTitle: cand.source?.title || 'Unknown Source',
      filename: cand.source?.filename || 'document.txt',
      versionNumber: cand.source?.versionNumber || 1,
      sectionPath: cand.provenance?.sectionPath ?? null,
      pageNumber: cand.provenance?.pageNumber ?? null,
      sourceOffset: cand.provenance?.sourceOffset ?? null,
      tokenCount: finalTokens,
      relevanceScore: Math.round(score * 10000) / 10000,
      content: finalContent,
      truncated,
    });

    currentTokens += finalTokens;
  }

  const insufficientEvidence = assembledItems.length === 0;

  return {
    items: assembledItems,
    totalTokens: currentTokens,
    totalChunks: assembledItems.length,
    candidateCount,
    deduplicatedCount,
    excludedPermissionCount,
    insufficientEvidence,
    reason: insufficientEvidence ? 'Context budget exhausted before including evidence.' : undefined,
  };
}
