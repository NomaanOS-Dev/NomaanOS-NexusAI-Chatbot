/**
 * NomaanOS Nexus AI - Citation Validation Service (Day 14)
 *
 * Validates generated citations against retrieved evidence and PostgreSQL permissions:
 * 1. Checks that citations reference actual backend-supplied evidence chunks (not fabricated).
 * 2. Re-validates that cited documents still exist, are active, and remain accessible to the caller.
 * 3. Rejects or omits invalid, inaccessible, or fabricated citations.
 * 4. Resolves secure, workspace-scoped source links.
 * 5. Sanitizes answer text by removing references to rejected/fabricated citations.
 */

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { AssembledEvidenceItem } from './evidence-assembler.js';
import { GroundedCitation } from './grounded-generator.js';

export type CitationValidationStatus = 'verified' | 'unverified' | 'invalid' | 'inaccessible' | 'fabricated';

export interface ValidatedCitation extends GroundedCitation {
  validationStatus: CitationValidationStatus;
  validationReason?: string | null;
  sourceUrl?: string | null;
  claimSupportScore?: number | null;
}

export interface CitationValidationResult {
  validCitations: ValidatedCitation[];
  rejectedCitations: ValidatedCitation[];
  sanitizedAnswer: string;
  hasFabrications: boolean;
  hasInaccessible: boolean;
}

export interface ValidateCitationsOptions {
  citations: GroundedCitation[];
  assembledEvidence: AssembledEvidenceItem[];
  workspaceId: string;
  answerText?: string;
  customPool?: any;
}

/**
 * Validates all candidate citations against retrieved evidence and database permissions.
 */
export async function validateCitations(
  options: ValidateCitationsOptions
): Promise<CitationValidationResult> {
  const {
    citations = [],
    assembledEvidence = [],
    workspaceId,
    answerText = '',
    customPool = pool,
  } = options;

  if (!workspaceId) {
    throw new Error('workspaceId is required for citation validation');
  }

  // 1. Build lookup map of legitimate retrieved evidence chunks
  const evidenceByChunkId = new Map<string, AssembledEvidenceItem>();
  const evidenceByCitationIndex = new Map<number, AssembledEvidenceItem>();

  for (const item of assembledEvidence) {
    if (item.chunkId) {
      evidenceByChunkId.set(item.chunkId, item);
    }
    evidenceByCitationIndex.set(item.citationIndex, item);
  }

  // 2. Classify citations into candidates for DB revalidation vs outright fabricated
  const candidateList: ValidatedCitation[] = [];
  const rejectedList: ValidatedCitation[] = [];
  const chunkIdsToCheck: string[] = [];

  for (const c of citations) {
    const matchingEvidence =
      (c.chunkId ? evidenceByChunkId.get(c.chunkId) : undefined) ||
      evidenceByCitationIndex.get(c.citationIndex);

    if (!matchingEvidence) {
      // Citation was NOT in retrieved evidence -> Fabricated by model
      rejectedList.push({
        ...c,
        validationStatus: 'fabricated',
        validationReason: `Citation [${c.citationIndex}] chunkId=${c.chunkId || 'none'} was not present in assembled evidence`,
        sourceUrl: null,
      });
      continue;
    }

    // Verify sourceId matches evidence
    if (c.sourceId && matchingEvidence.sourceId && c.sourceId !== matchingEvidence.sourceId) {
      rejectedList.push({
        ...c,
        validationStatus: 'fabricated',
        validationReason: `Citation [${c.citationIndex}] sourceId=${c.sourceId} does not match evidence sourceId=${matchingEvidence.sourceId}`,
        sourceUrl: null,
      });
      continue;
    }

    const chunkIdToUse = matchingEvidence.chunkId;
    chunkIdsToCheck.push(chunkIdToUse);

    // Merge verified metadata from assembled evidence
    candidateList.push({
      ...c,
      chunkId: chunkIdToUse,
      sourceId: matchingEvidence.sourceId,
      sourceTitle: matchingEvidence.sourceTitle,
      filename: matchingEvidence.filename,
      versionNumber: matchingEvidence.versionNumber,
      sectionPath: matchingEvidence.sectionPath,
      pageNumber: matchingEvidence.pageNumber,
      sourceOffset: matchingEvidence.sourceOffset,
      relevanceScore: matchingEvidence.relevanceScore,
      validationStatus: 'unverified',
    });
  }

  // 3. Batch DB permission check for all matching candidate chunks
  const accessibleChunkIds = new Set<string>();
  if (chunkIdsToCheck.length > 0) {
    try {
      const query = `
        SELECT dc.id AS chunk_id, ds.id AS source_id, ds.workspace_id, ds.status AS source_status, dv.status AS version_status
        FROM document_chunks dc
        JOIN document_sources ds ON dc.source_id = ds.id
        JOIN document_versions dv ON dc.version_id = dv.id
        WHERE dc.id = ANY($1::uuid[])
          AND dc.workspace_id = $2::uuid
          AND ds.workspace_id = $2::uuid
          AND dc.is_active = TRUE
          AND ds.status NOT IN ('failed', 'error', 'archived')
          AND dv.status = 'active';
      `;
      const res = await customPool.query(query, [chunkIdsToCheck, workspaceId]);
      for (const row of res.rows) {
        accessibleChunkIds.add(row.chunk_id);
      }
    } catch (err) {
      logger.error({ err }, 'Error during citation accessibility verification');
      // Fail closed: accessibleChunkIds remains empty on DB error
    }
  }

  // 4. Final classification of candidates
  const validList: ValidatedCitation[] = [];

  for (const cand of candidateList) {
    if (!accessibleChunkIds.has(cand.chunkId)) {
      rejectedList.push({
        ...cand,
        validationStatus: 'inaccessible',
        validationReason: `Source document or chunk ${cand.chunkId} is archived, deleted, or inaccessible to workspace`,
        sourceUrl: null,
      });
    } else {
      // Secure, workspace-scoped source link
      const sourceUrl = `/api/v1/workspaces/${workspaceId}/sources/${cand.sourceId}`;
      validList.push({
        ...cand,
        validationStatus: 'verified',
        validationReason: null,
        sourceUrl,
      });
    }
  }

  // 5. Sanitize answer text: strip or qualify bracketed citations that were rejected
  const validIndices = new Set(validList.map((v) => v.citationIndex));
  const sanitizedAnswer = sanitizeAnswerCitations(answerText, validIndices);

  return {
    validCitations: validList,
    rejectedCitations: rejectedList,
    sanitizedAnswer,
    hasFabrications: rejectedList.some((r) => r.validationStatus === 'fabricated'),
    hasInaccessible: rejectedList.some((r) => r.validationStatus === 'inaccessible'),
  };
}

/**
 * Sanitizes answer text by removing references to bracketed citation numbers that failed validation.
 * E.g., if citation [3] was fabricated, converts "[3]" to "" or removes dangling invalid citation tags.
 */
export function sanitizeAnswerCitations(answer: string, validCitationIndices: Set<number>): string {
  if (!answer) return '';

  return answer.replace(/\[(\d+)\]/g, (match, p1) => {
    const idx = parseInt(p1, 10);
    if (validCitationIndices.has(idx)) {
      return match; // Keep valid citation
    }
    // Omit fabricated / invalid citation
    return '';
  }).replace(/\s{2,}/g, ' '); // Clean up duplicate spaces
}

