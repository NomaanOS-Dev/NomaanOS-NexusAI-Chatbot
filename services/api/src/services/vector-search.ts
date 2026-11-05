/**
 * NomaanOS Nexus AI - Vector Retrieval & Semantic Search Service (Day 9)
 *
 * Implements pgvector HNSW cosine similarity search over chunk_embeddings
 * with tenant/workspace scoping, knowledge space isolation, version supersession filters,
 * and traceable provenance metadata.
 */

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { generateEmbedding, getDefaultEmbeddingModel, getModelById, EmbeddingModelRecord } from './embedding-service.js';
import { SearchFilters } from './keyword-search.js';

export interface VectorSearchResultItem {
  chunkId: string;
  content: string;
  similarityScore: number;
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

export interface VectorSearchResponse {
  query: string;
  totalResults: number;
  model: {
    id: string;
    modelId: string;
    dimensions: number;
    distanceMetric: string;
  };
  timingsMs: {
    embeddingGeneration: number;
    vectorQuery: number;
    total: number;
  };
  results: VectorSearchResultItem[];
}

export interface VectorSearchOptions {
  workspaceId: string;
  knowledgeSpaceId: string;
  query: string;
  topK?: number;
  minScore?: number;
  modelId?: string;
  filters?: SearchFilters;
}

export class VectorSearchError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'VectorSearchError';
    this.statusCode = statusCode;
  }
}

/**
 * Executes semantic similarity search against indexed document chunks.
 */
export async function searchKnowledgeSpace(
  options: VectorSearchOptions
): Promise<VectorSearchResponse> {
  const startTime = Date.now();
  const { workspaceId, knowledgeSpaceId, query } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new VectorSearchError('Search query must be a non-empty string.', 400);
  }

  if (query.length > 2000) {
    throw new VectorSearchError('Search query exceeds maximum allowed length of 2000 characters.', 400);
  }

  const topK = Math.min(Math.max(1, options.topK ?? 5), 50);
  const minScore = options.minScore !== undefined ? Math.max(-1.0, Math.min(1.0, options.minScore)) : 0.0;

  // 1. Validate Workspace & Knowledge Space isolation
  const spaceCheck = await pool.query(
    `SELECT id, name FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2 AND status = 'active';`,
    [knowledgeSpaceId, workspaceId]
  );

  if (spaceCheck.rows.length === 0) {
    throw new VectorSearchError(
      `Knowledge space '${knowledgeSpaceId}' was not found or is not active in workspace '${workspaceId}'.`,
      404
    );
  }

  // 2. Resolve embedding model
  let model: EmbeddingModelRecord;
  if (options.modelId) {
    model = await getModelById(options.modelId);
  } else {
    model = await getDefaultEmbeddingModel();
  }

  // 3. Generate query vector embedding via local adapter
  const embedStart = Date.now();
  const queryVector = await generateEmbedding(query, model.id);
  const embedTime = Date.now() - embedStart;

  const vectorStr = `[${queryVector.join(',')}]`;

  // 4. Build dynamic filter clauses
  const params: any[] = [
    vectorStr,        // $1
    workspaceId,      // $2
    knowledgeSpaceId, // $3
    model.id,         // $4
    minScore,         // $5
  ];

  let paramIndex = 6;
  const whereClauses: string[] = [
    `ce.workspace_id = $2`,
    `ce.knowledge_space_id = $3`,
    `ce.is_active = TRUE`,
    `dc.is_active = TRUE`,
    `dv.status = 'active'`,
    `(dv.is_current = TRUE OR ds.current_version_id = dv.id)`,
    `ce.model_id = $4`,
    `(1 - (ce.embedding <=> $1::vector)) >= $5`,
  ];

  const { filters } = options;
  const targetSourceIds = filters?.sourceId || filters?.documentSourceId;
  if (targetSourceIds) {
    const ids = Array.isArray(targetSourceIds) ? targetSourceIds : [targetSourceIds];
    if (ids.length > 0) {
      params.push(ids);
      whereClauses.push(`dc.source_id = ANY($${paramIndex++}::uuid[])`);
    }
  }

  if (filters?.product && typeof filters.product === 'string') {
    params.push(filters.product);
    whereClauses.push(
      `(ds.metadata->>'product' = $${paramIndex} OR dc.metadata->>'product' = $${paramIndex})`
    );
    paramIndex++;
  }

  if (filters?.sectionPath && typeof filters.sectionPath === 'string') {
    params.push(`%${filters.sectionPath}%`);
    whereClauses.push(`dc.section_path ILIKE $${paramIndex++}`);
  }

  if (filters?.metadata && typeof filters.metadata === 'object' && Object.keys(filters.metadata).length > 0) {
    params.push(JSON.stringify(filters.metadata));
    whereClauses.push(
      `(ds.metadata @> $${paramIndex}::jsonb OR dc.metadata @> $${paramIndex}::jsonb)`
    );
    paramIndex++;
  }

  params.push(topK);
  const topKParamIndex = paramIndex++;

  // 5. Execute pgvector Cosine Distance Retrieval
  const queryStart = Date.now();
  const searchQuery = `
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
      (1 - (ce.embedding <=> $1::vector)) AS similarity_score
    FROM chunk_embeddings ce
    JOIN document_chunks dc ON ce.chunk_id = dc.id
    JOIN document_sources ds ON dc.source_id = ds.id
    JOIN document_versions dv ON dc.version_id = dv.id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ce.embedding <=> $1::vector ASC
    LIMIT $${topKParamIndex};
  `;

  const searchRes = await pool.query(searchQuery, params);
  const vectorQueryTime = Date.now() - queryStart;

  const results: VectorSearchResultItem[] = searchRes.rows.map(row => {
    const rawScore = parseFloat(row.similarity_score);
    // Round to 4 decimal places
    const similarityScore = Math.round(rawScore * 10000) / 10000;

    return {
      chunkId: row.chunk_id,
      content: row.content,
      similarityScore,
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

  const totalTime = Date.now() - startTime;

  logger.info(
    {
      workspaceId,
      knowledgeSpaceId,
      resultsCount: results.length,
      topScore: results[0]?.similarityScore ?? null,
      totalTime,
    },
    'Executed semantic vector retrieval'
  );

  return {
    query,
    totalResults: results.length,
    model: {
      id: model.id,
      modelId: model.modelId,
      dimensions: model.dimensions,
      distanceMetric: model.distanceMetric,
    },
    timingsMs: {
      embeddingGeneration: embedTime,
      vectorQuery: vectorQueryTime,
      total: totalTime,
    },
    results,
  };
}

