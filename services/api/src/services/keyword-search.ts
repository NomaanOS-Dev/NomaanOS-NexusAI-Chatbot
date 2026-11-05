/**
 * NomaanOS Nexus AI - Keyword Search Service (Day 10)
 *
 * Implements PostgreSQL Full-Text Search and exact technical identifier retrieval
 * using websearch_to_tsquery, ts_rank_cd, trigram/ILIKE exact matching,
 * and metadata/product filtering with strict workspace/tenant boundaries.
 */

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { KeywordSearchResultItem } from './rrf.js';

export interface SearchFilters {
  sourceId?: string | string[];
  documentSourceId?: string | string[];
  product?: string;
  metadata?: Record<string, any>;
  sectionPath?: string;
}

export interface KeywordSearchOptions {
  workspaceId: string;
  knowledgeSpaceId: string;
  query: string;
  topK?: number;
  minScore?: number;
  filters?: SearchFilters;
}

export interface KeywordSearchResponse {
  query: string;
  totalResults: number;
  results: KeywordSearchResultItem[];
  timingMs: number;
}

export class KeywordSearchError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'KeywordSearchError';
    this.statusCode = statusCode;
  }
}

function buildOrTsQuery(raw: string): string | null {
  const tokens = raw
    .replace(/[^\w\s\-\/\.]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(t => t.replace(/'/g, '').trim())
    .filter(t => t.length > 0)
    .slice(0, 15);
  if (tokens.length === 0) return null;
  return tokens.map(t => `'${t}'`).join(' | ');
}

/**
 * Searches document chunks in a knowledge space using PostgreSQL Full-Text Search
 * and exact technical identifier matching.
 */
export async function searchKeywordKnowledgeSpace(
  options: KeywordSearchOptions
): Promise<KeywordSearchResponse> {
  const startTime = Date.now();
  const { workspaceId, knowledgeSpaceId, query, filters } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new KeywordSearchError('Search query must be a non-empty string.', 400);
  }

  if (query.length > 2000) {
    throw new KeywordSearchError('Search query exceeds maximum allowed length of 2000 characters.', 400);
  }

  const cleanQuery = query.trim();
  const topK = Math.min(Math.max(1, options.topK ?? 5), 50);
  const minScore = options.minScore !== undefined ? Math.max(0.0, options.minScore) : 0.0;

  // 1. Verify workspace & knowledge space membership
  const spaceCheck = await pool.query(
    `SELECT id, name FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2 AND status = 'active';`,
    [knowledgeSpaceId, workspaceId]
  );

  if (spaceCheck.rows.length === 0) {
    throw new KeywordSearchError(
      `Knowledge space '${knowledgeSpaceId}' was not found or is not active in workspace '${workspaceId}'.`,
      404
    );
  }

  // 2. Build dynamic filter conditions and query parameters
  const orQuery = buildOrTsQuery(cleanQuery) || cleanQuery;
  const params: any[] = [
    cleanQuery,       // $1: raw query string
    workspaceId,      // $2
    knowledgeSpaceId, // $3
    orQuery,          // $4: OR-joined tsquery
  ];

  let paramIndex = 5;
  const whereClauses: string[] = [
    `dc.workspace_id = $2`,
    `dc.knowledge_space_id = $3`,
    `dc.is_active = TRUE`,
    `dv.status = 'active'`,
    `(dv.is_current = TRUE OR ds.current_version_id = dv.id)`,
  ];

  // Filter by Source ID(s)
  const targetSourceIds = filters?.sourceId || filters?.documentSourceId;
  if (targetSourceIds) {
    const ids = Array.isArray(targetSourceIds) ? targetSourceIds : [targetSourceIds];
    if (ids.length > 0) {
      params.push(ids);
      whereClauses.push(`dc.source_id = ANY($${paramIndex++}::uuid[])`);
    }
  }

  // Filter by Product (in document_sources or document_chunks metadata)
  if (filters?.product && typeof filters.product === 'string') {
    params.push(filters.product);
    whereClauses.push(
      `(ds.metadata->>'product' = $${paramIndex} OR dc.metadata->>'product' = $${paramIndex})`
    );
    paramIndex++;
  }

  // Filter by Section Path substring
  if (filters?.sectionPath && typeof filters.sectionPath === 'string') {
    params.push(`%${filters.sectionPath}%`);
    whereClauses.push(`dc.section_path ILIKE $${paramIndex++}`);
  }

  // Filter by Arbitrary Metadata (JSONB containment)
  if (filters?.metadata && typeof filters.metadata === 'object' && Object.keys(filters.metadata).length > 0) {
    params.push(JSON.stringify(filters.metadata));
    whereClauses.push(
      `(ds.metadata @> $${paramIndex}::jsonb OR dc.metadata @> $${paramIndex}::jsonb)`
    );
    paramIndex++;
  }

  // Match condition: Full-Text Search OR Exact substring / technical code match
  const matchCondition = `(
    dc.tsv @@ websearch_to_tsquery('english', $1)
    OR dc.tsv @@ plainto_tsquery('english', $1)
    OR to_tsvector('english', coalesce(dc.section_path, '') || ' ' || dc.content || ' ' || ds.title) @@ to_tsquery('english', $4)
    OR dc.content ILIKE '%' || $1 || '%'
    OR dc.section_path ILIKE '%' || $1 || '%'
    OR ds.title ILIKE '%' || $1 || '%'
  )`;
  whereClauses.push(matchCondition);

  params.push(minScore);
  const minScoreParamIndex = paramIndex++;

  params.push(topK);
  const topKParamIndex = paramIndex++;

  const sql = `
    WITH scored_chunks AS (
      SELECT 
        dc.id AS chunk_id,
        dc.source_id,
        dc.version_id,
        dc.chunk_index,
        dc.content,
        dc.token_count,
        dc.section_path,
        dc.page_number,
        dc.source_offset,
        dc.metadata AS chunk_metadata,
        ds.title AS source_title,
        ds.filename AS source_filename,
        dv.version_number,
        dv.sha256 AS version_sha256,
        (
          COALESCE(ts_rank_cd(dc.tsv, websearch_to_tsquery('english', $1)), 0.0) * 1.5 +
          COALESCE(ts_rank_cd(to_tsvector('english', coalesce(dc.section_path, '') || ' ' || dc.content), to_tsquery('english', $4)), 0.0) +
          COALESCE(ts_rank_cd(dc.tsv, plainto_tsquery('english', $1)), 0.0) +
          (CASE WHEN dc.content ILIKE '%' || $1 || '%' THEN 0.50 ELSE 0.0 END) +
          (CASE WHEN dc.section_path ILIKE '%' || $1 || '%' THEN 0.35 ELSE 0.0 END) +
          (CASE WHEN ds.title ILIKE '%' || $1 || '%' THEN 0.25 ELSE 0.0 END)
        ) AS raw_keyword_score
      FROM document_chunks dc
      JOIN document_sources ds ON dc.source_id = ds.id
      JOIN document_versions dv ON dc.version_id = dv.id
      WHERE ${whereClauses.join(' AND ')}
    )
    SELECT *
    FROM scored_chunks
    WHERE raw_keyword_score >= $${minScoreParamIndex}
    ORDER BY raw_keyword_score DESC, chunk_index ASC
    LIMIT $${topKParamIndex};
  `;

  const queryRes = await pool.query(sql, params);
  const timingMs = Date.now() - startTime;

  const results: KeywordSearchResultItem[] = queryRes.rows.map(row => {
    const rawScore = parseFloat(row.raw_keyword_score);
    const keywordScore = Math.round(rawScore * 10000) / 10000;

    return {
      chunkId: row.chunk_id,
      content: row.content,
      keywordScore,
      source: {
        id: row.source_id,
        title: row.source_title,
        filename: row.source_filename,
        versionNumber: row.version_number,
        sha256: row.version_sha256,
      },
      provenance: {
        sectionPath: row.section_path,
        pageNumber: row.page_number,
        sourceOffset: row.source_offset,
        chunkIndex: row.chunk_index,
      },
      tokenCount: row.token_count,
      metadata: row.chunk_metadata || {},
    };
  });

  logger.info(
    {
      workspaceId,
      knowledgeSpaceId,
      resultsCount: results.length,
      topScore: results[0]?.keywordScore ?? null,
      timingMs,
    },
    'Executed keyword retrieval'
  );

  return {
    query: cleanQuery,
    totalResults: results.length,
    results,
    timingMs,
  };
}
