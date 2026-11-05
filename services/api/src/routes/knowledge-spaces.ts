import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import {
  authenticate,
  requireWorkspaceAdmin,
  requireWorkspaceAnalyst,
  requireWorkspaceViewer,
} from '../middleware/auth.js';
import { recordAuditEvent } from '../services/audit-service.js';
import { handleSourceUpload } from './knowledge-sources.js';
import { searchKnowledgeSpace, VectorSearchError } from '../services/vector-search.js';
import { searchKeywordKnowledgeSpace, KeywordSearchError } from '../services/keyword-search.js';
import { searchHybridKnowledgeSpace, HybridSearchError, SearchMode } from '../services/hybrid-search.js';
import { adaptiveRetrieve, AdaptiveRetrievalError } from '../services/adaptive-retrieval.js';
import { analyzeQuery } from '../services/query-understanding.js';
import { reindexKnowledgeSpace, getDefaultEmbeddingModel } from '../services/embedding-service.js';
import { rerankCandidates } from '../services/reranker.js';
import { runRetrievalEvaluation } from '../services/retrieval-evaluation.js';
import { HybridSearchResultItem } from '../services/rrf.js';

export const knowledgeSpacesRouter = Router({ mergeParams: true });

const CreateKnowledgeSpaceSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z0-9_\-]+$/i, {
      message: 'Slug must contain alphanumeric, underscore, or hyphen characters',
    }),
  description: z.string().max(1000).optional().nullable(),
});

const UpdateKnowledgeSpaceSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  status: z.enum(['active', 'suspended', 'archived']).optional(),
});

// 1. Create Knowledge Space (Analyst+)
knowledgeSpacesRouter.post(
  '/',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = CreateKnowledgeSpaceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid knowledge space parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const { name, slug, description } = parse.data;

      const existingSlug = await pool.query(
        `SELECT id FROM knowledge_spaces WHERE workspace_id = $1 AND slug = $2;`,
        [workspaceId, slug]
      );

      if (existingSlug.rows.length > 0) {
        res.status(409).json({
          error: 'ConflictError',
          message: `Knowledge space with slug '${slug}' already exists in this workspace.`,
          statusCode: 409,
        });
        return;
      }

      const insertRes = await pool.query(
        `INSERT INTO knowledge_spaces (workspace_id, name, slug, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, workspace_id, name, slug, description, status, created_at, updated_at;`,
        [workspaceId, name, slug, description || null]
      );

      const space = insertRes.rows[0];

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'knowledge_space_created',
        resourceType: 'knowledge_space',
        resourceId: space.id,
        details: { name: space.name, slug: space.slug },
        ipAddress: req.ip,
      });

      res.status(201).json({ status: 'ok', knowledgeSpace: space });
    } catch (err) {
      next(err);
    }
  }
);

// 2. List Knowledge Spaces (Viewer+)
knowledgeSpacesRouter.get(
  '/',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;

      const result = await pool.query(
        `SELECT id, workspace_id, name, slug, description, status, created_at, updated_at
         FROM knowledge_spaces
         WHERE workspace_id = $1
         ORDER BY created_at DESC;`,
        [workspaceId]
      );

      res.status(200).json({
        status: 'ok',
        knowledgeSpaces: result.rows,
        total: result.rows.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2b. List Configured Embedding Models (Viewer+)
// GET /api/v1/workspaces/:workspaceId/knowledge-spaces/embedding-models
knowledgeSpacesRouter.get(
  '/embedding-models',
  authenticate,
  requireWorkspaceViewer,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `SELECT id, model_id, model_name, provider, dimensions, distance_metric, is_normalized, is_default, status, metadata
         FROM embedding_models
         ORDER BY is_default DESC, created_at ASC;`
      );
      res.status(200).json({ status: 'ok', models: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Get Knowledge Space by ID (Viewer+)
knowledgeSpacesRouter.get(
  '/:knowledgeSpaceId',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const spaceId = req.params.knowledgeSpaceId as string;

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spaceId)) {
        return next();
      }

      const result = await pool.query(
        `SELECT id, workspace_id, name, slug, description, status, created_at, updated_at
         FROM knowledge_spaces
         WHERE id = $1 AND workspace_id = $2;`,
        [spaceId, workspaceId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Knowledge space not found.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({ status: 'ok', knowledgeSpace: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Update Knowledge Space (Analyst+)
knowledgeSpacesRouter.patch(
  '/:knowledgeSpaceId',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = UpdateKnowledgeSpaceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid knowledge space update payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const spaceId = req.params.knowledgeSpaceId;
      const data = parse.data;

      const checkRes = await pool.query(
        `SELECT id, name FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
        [spaceId, workspaceId]
      );

      if (checkRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Knowledge space not found.',
          statusCode: 404,
        });
        return;
      }

      const updateRes = await pool.query(
        `UPDATE knowledge_spaces
         SET 
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           updated_at = NOW()
         WHERE id = $4 AND workspace_id = $5
         RETURNING id, workspace_id, name, slug, description, status, created_at, updated_at;`,
        [data.name || null, data.description || null, data.status || null, spaceId, workspaceId]
      );

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'knowledge_space_updated',
        resourceType: 'knowledge_space',
        resourceId: spaceId,
        details: data,
        ipAddress: req.ip,
      });

      res.status(200).json({ status: 'ok', knowledgeSpace: updateRes.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Delete Knowledge Space (Admin+)
knowledgeSpacesRouter.delete(
  '/:knowledgeSpaceId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const spaceId = req.params.knowledgeSpaceId;

      const deleteRes = await pool.query(
        `DELETE FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2 RETURNING id, name;`,
        [spaceId, workspaceId]
      );

      if (deleteRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Knowledge space not found.',
          statusCode: 404,
        });
        return;
      }

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'knowledge_space_deleted',
        resourceType: 'knowledge_space',
        resourceId: spaceId,
        details: { name: deleteRes.rows[0].name },
        ipAddress: req.ip,
      });

      res.status(200).json({ status: 'ok', message: 'Knowledge space deleted successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

// 6. Associate Knowledge Space with Assistant (Analyst+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/assistants/:assistantId
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/assistants/:assistantId',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { knowledgeSpaceId, assistantId } = req.params;

      // STRICT Cross-tenant verification:
      // Verify knowledge space belongs to caller's workspace
      const spaceCheck = await pool.query(
        `SELECT id, name FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
        [knowledgeSpaceId, workspaceId]
      );
      if (spaceCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Knowledge space not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      // Verify assistant belongs to caller's workspace
      const assistantCheck = await pool.query(
        `SELECT id, name FROM assistants WHERE id = $1 AND workspace_id = $2;`,
        [assistantId, workspaceId]
      );
      if (assistantCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Assistant not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      await pool.query(
        `INSERT INTO assistant_knowledge_spaces (assistant_id, knowledge_space_id)
         VALUES ($1, $2)
         ON CONFLICT (assistant_id, knowledge_space_id) DO NOTHING;`,
        [assistantId, knowledgeSpaceId]
      );

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_knowledge_space_linked',
        resourceType: 'assistant_knowledge_space',
        resourceId: `${assistantId}:${knowledgeSpaceId}`,
        details: {
          assistantId,
          knowledgeSpaceId,
          assistantName: assistantCheck.rows[0].name,
          knowledgeSpaceName: spaceCheck.rows[0].name,
        },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Knowledge space successfully linked to assistant.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// 7. Unlink Knowledge Space from Assistant (Analyst+)
knowledgeSpacesRouter.delete(
  '/:knowledgeSpaceId/assistants/:assistantId',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { knowledgeSpaceId, assistantId } = req.params;

      // Verify both belong to caller workspace
      const spaceCheck = await pool.query(
        `SELECT id FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
        [knowledgeSpaceId, workspaceId]
      );
      const assistantCheck = await pool.query(
        `SELECT id FROM assistants WHERE id = $1 AND workspace_id = $2;`,
        [assistantId, workspaceId]
      );

      if (spaceCheck.rows.length === 0 || assistantCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Knowledge space or assistant not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      await pool.query(
        `DELETE FROM assistant_knowledge_spaces WHERE assistant_id = $1 AND knowledge_space_id = $2;`,
        [assistantId, knowledgeSpaceId]
      );

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_knowledge_space_unlinked',
        resourceType: 'assistant_knowledge_space',
        resourceId: `${assistantId}:${knowledgeSpaceId}`,
        details: { assistantId, knowledgeSpaceId },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Knowledge space unlinked from assistant.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// 8. Upload and Register Document Source to Knowledge Space (Analyst+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/sources
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/sources',
  authenticate,
  requireWorkspaceAnalyst,
  handleSourceUpload
);

const SearchKnowledgeSpaceSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').max(2000),
  searchMode: z.enum(['hybrid', 'semantic', 'keyword']).optional(),
  mode: z.enum(['hybrid', 'semantic', 'keyword']).optional(),
  adaptive: z.boolean().optional().default(false),
  maxRetries: z.number().int().min(0).max(3).optional().default(1),
  rerank: z.boolean().optional().default(false),
  rerankerModel: z.string().optional(),
  rerankTopK: z.number().int().min(1).max(50).optional(),
  topK: z.number().int().min(1).max(50).optional().default(5),
  minScore: z.number().min(-1.0).max(1.0).optional(),
  minSimilarity: z.number().min(-1.0).max(1.0).optional(),
  rrfK: z.number().int().min(1).max(200).optional().default(60),
  semanticWeight: z.number().min(0).max(100).optional().default(1.0),
  keywordWeight: z.number().min(0).max(100).optional().default(1.0),
  modelId: z.string().optional(),
  filters: z
    .object({
      sourceId: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
      documentSourceId: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
      product: z.string().optional(),
      sectionPath: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
});

// 9. Semantic & Hybrid Search in Knowledge Space (Viewer+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/search
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/search',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = SearchKnowledgeSpaceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid search parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;
      const {
        query,
        searchMode,
        mode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        adaptive,
        maxRetries,
        rerank,
        rerankerModel,
        rerankTopK,
      } = parse.data;

      const resolvedMode: SearchMode = (searchMode || mode || (req.body.mode ? req.body.mode : 'hybrid')) as SearchMode;

      if (adaptive) {
        const adaptiveResponse = await adaptiveRetrieve({
          workspaceId,
          knowledgeSpaceId,
          query,
          searchMode: resolvedMode,
          topK,
          minScore,
          minSimilarity,
          rrfK,
          semanticWeight,
          keywordWeight,
          modelId,
          filters,
          maxRetries,
        });

        res.status(200).json({
          status: 'ok',
          ...adaptiveResponse,
        });
        return;
      }

      const searchResponse = await searchHybridKnowledgeSpace({
        workspaceId,
        knowledgeSpaceId,
        query,
        searchMode: resolvedMode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        rerank,
        rerankerModel,
        rerankTopK,
      });

      res.status(200).json({
        status: 'ok',
        ...searchResponse,
      });
    } catch (err: any) {
      if (
        err instanceof HybridSearchError ||
        err instanceof VectorSearchError ||
        err instanceof KeywordSearchError ||
        err instanceof AdaptiveRetrievalError
      ) {
        res.status(err.statusCode).json({
          error: err.name,
          message: err.message,
          statusCode: err.statusCode,
        });
        return;
      }
      next(err);
    }
  }
);

// 10. Dedicated Adaptive Retrieval in Knowledge Space (Viewer+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/adaptive-search
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/adaptive-search',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = SearchKnowledgeSpaceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid search parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;
      const {
        query,
        searchMode,
        mode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        maxRetries,
      } = parse.data;

      const resolvedMode: SearchMode = (searchMode || mode || 'hybrid') as SearchMode;

      const adaptiveResponse = await adaptiveRetrieve({
        workspaceId,
        knowledgeSpaceId,
        query,
        searchMode: resolvedMode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        maxRetries,
      });

      res.status(200).json({
        status: 'ok',
        ...adaptiveResponse,
      });
    } catch (err: any) {
      if (
        err instanceof HybridSearchError ||
        err instanceof VectorSearchError ||
        err instanceof KeywordSearchError ||
        err instanceof AdaptiveRetrievalError
      ) {
        res.status(err.statusCode).json({
          error: err.name,
          message: err.message,
          statusCode: err.statusCode,
        });
        return;
      }
      next(err);
    }
  }
);

// 11. Query Understanding & Routing Analysis (Viewer+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/query-understanding
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/query-understanding',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = typeof req.body?.query === 'string' ? req.body.query : '';
      if (!query || query.trim().length === 0) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Search query must be a non-empty string.',
          statusCode: 400,
        });
        return;
      }

      const analysis = analyzeQuery(query);
      res.status(200).json({
        status: 'ok',
        ...analysis,
      });
    } catch (err: any) {
      next(err);
    }
  }
);

// 10. Re-index Chunks in Knowledge Space (Analyst+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/reindex
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/reindex',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;
      const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : undefined;

      const reindexResult = await reindexKnowledgeSpace(workspaceId, knowledgeSpaceId, modelId);

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'knowledge_space_reindexed',
        resourceType: 'knowledge_space',
        resourceId: knowledgeSpaceId,
        details: reindexResult,
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Knowledge space re-indexing completed successfully.',
        ...reindexResult,
      });
    } catch (err: any) {
      next(err);
    }
  }
);

const RerankCandidatesSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(2000),
  candidates: z
    .array(
      z
        .object({
          id: z.string().optional(),
          content: z.string().min(1, 'Candidate content cannot be empty'),
          score: z.number().optional(),
        })
        .passthrough()
    )
    .min(1, 'Must provide at least one candidate'),
  model: z.string().optional(),
  topK: z.number().int().min(1).max(100).optional(),
  strategy: z.enum(['cross-encoder', 'heuristic']).optional(),
});

function mapCandidatesToHybridItems(candidates: any[]): HybridSearchResultItem[] {
  return candidates.map((item, index) => ({
    chunkId: item.chunkId || item.id || `candidate-${index}`,
    content: item.content,
    rrfScore: typeof item.rrfScore === 'number' ? item.rrfScore : (item.score ?? 1 / (60 + index + 1)),
    similarityScore: item.similarityScore ?? null,
    keywordScore: item.keywordScore ?? null,
    rerankScore: item.rerankScore,
    rankings: item.rankings || {
      rrfRank: index + 1,
      semanticRank: null,
      keywordRank: null,
    },
    source: item.source || {
      id: item.sourceId || '',
      title: item.title || '',
      filename: item.filename || '',
      versionNumber: item.versionNumber ?? 1,
    },
    provenance: item.provenance || {
      sectionPath: null,
      pageNumber: null,
      sourceOffset: null,
      chunkIndex: index,
    },
    tokenCount: item.tokenCount || (item.content ? item.content.split(/\s+/).length : 0),
    metadata: item.metadata || {},
  }));
}

const RunEvaluationSchema = z.object({
  datasetPath: z.string().optional(),
  dataset: z.any().optional(),
  kValues: z.array(z.number().int().min(1).max(50)).optional(),
  rerankerModel: z.string().optional(),
  strategy: z.enum(['cross-encoder', 'heuristic']).optional(),
});

// 11. Rerank Candidates in Knowledge Space (Viewer+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/rerank
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/rerank',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = RerankCandidatesSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid rerank parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { query, candidates, model, topK, strategy } = parse.data;
      const mappedCandidates = mapCandidatesToHybridItems(candidates);
      const result = await rerankCandidates(query, mappedCandidates, {
        modelId: model,
        topK,
        strategy,
      });

      res.status(200).json({
        status: 'ok',
        query,
        results: result.results,
        modelId: result.modelId,
        strategyUsed: result.strategyUsed,
        timingMs: result.timingMs,
        rerankedCount: result.results.length,
      });
    } catch (err: any) {
      next(err);
    }
  }
);

// 12. Run Retrieval Evaluation (Analyst+)
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/evaluation/run
knowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/evaluation/run',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;
      const parse = RunEvaluationSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid evaluation parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { datasetPath, dataset, kValues, rerankerModel, strategy } = parse.data;

      const report = await runRetrievalEvaluation({
        workspaceId,
        knowledgeSpaceId,
        datasetPath,
        dataset,
        kValues,
        rerankerModel,
        strategy,
      });

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'retrieval_evaluation_executed',
        resourceType: 'knowledge_space',
        resourceId: knowledgeSpaceId,
        details: {
          datasetVersion: report.datasetVersion,
          queryCount: report.queryCount,
          baseline: report.baseline,
          reranked: report.reranked,
          deltas: report.deltas,
          accessControl: report.accessControl,
        },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        ...report,
      });
    } catch (err: any) {
      next(err);
    }
  }
);

// Standalone Direct Router for /api/v1/knowledge-spaces/:knowledgeSpaceId/search
export const directKnowledgeSpacesRouter = Router();

directKnowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/search',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;

      // Locate workspace for this knowledge space
      const spaceRes = await pool.query(
        `SELECT id, workspace_id FROM knowledge_spaces WHERE id = $1 AND status = 'active';`,
        [knowledgeSpaceId]
      );

      if (spaceRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `Knowledge space '${knowledgeSpaceId}' does not exist or is inactive.`,
          statusCode: 404,
        });
        return;
      }

      const workspaceId = spaceRes.rows[0].workspace_id;

      // Verify caller membership in workspace
      const memberRes = await pool.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, req.user!.id]
      );

      if (memberRes.rows.length === 0) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to the workspace associated with this knowledge space.',
          statusCode: 403,
        });
        return;
      }

      const parse = SearchKnowledgeSpaceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid search parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const {
        query,
        searchMode,
        mode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        adaptive,
        maxRetries,
        rerank,
        rerankerModel,
        rerankTopK,
      } = parse.data;

      const resolvedMode: SearchMode = (searchMode || mode || 'hybrid') as SearchMode;

      if (adaptive) {
        const adaptiveResponse = await adaptiveRetrieve({
          workspaceId,
          knowledgeSpaceId,
          query,
          searchMode: resolvedMode,
          topK,
          minScore,
          minSimilarity,
          rrfK,
          semanticWeight,
          keywordWeight,
          modelId,
          filters,
          maxRetries,
        });

        res.status(200).json({
          status: 'ok',
          ...adaptiveResponse,
        });
        return;
      }

      const searchResponse = await searchHybridKnowledgeSpace({
        workspaceId,
        knowledgeSpaceId,
        query,
        searchMode: resolvedMode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        rerank,
        rerankerModel,
        rerankTopK,
      });

      res.status(200).json({
        status: 'ok',
        ...searchResponse,
      });
    } catch (err: any) {
      if (
        err instanceof HybridSearchError ||
        err instanceof VectorSearchError ||
        err instanceof KeywordSearchError ||
        err instanceof AdaptiveRetrievalError
      ) {
        res.status(err.statusCode).json({
          error: err.name,
          message: err.message,
          statusCode: err.statusCode,
        });
        return;
      }
      next(err);
    }
  }
);

// Standalone Direct Router for /api/v1/knowledge-spaces/:knowledgeSpaceId/adaptive-search
directKnowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/adaptive-search',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;

      const spaceRes = await pool.query(
        `SELECT id, workspace_id FROM knowledge_spaces WHERE id = $1 AND status = 'active';`,
        [knowledgeSpaceId]
      );

      if (spaceRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `Knowledge space '${knowledgeSpaceId}' does not exist or is inactive.`,
          statusCode: 404,
        });
        return;
      }

      const workspaceId = spaceRes.rows[0].workspace_id;

      const memberRes = await pool.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, req.user!.id]
      );

      if (memberRes.rows.length === 0) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to the workspace associated with this knowledge space.',
          statusCode: 403,
        });
        return;
      }

      const parse = SearchKnowledgeSpaceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid search parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const {
        query,
        searchMode,
        mode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        maxRetries,
      } = parse.data;

      const resolvedMode: SearchMode = (searchMode || mode || 'hybrid') as SearchMode;

      const adaptiveResponse = await adaptiveRetrieve({
        workspaceId,
        knowledgeSpaceId,
        query,
        searchMode: resolvedMode,
        topK,
        minScore,
        minSimilarity,
        rrfK,
        semanticWeight,
        keywordWeight,
        modelId,
        filters,
        maxRetries,
      });

      res.status(200).json({
        status: 'ok',
        ...adaptiveResponse,
      });
    } catch (err: any) {
      if (
        err instanceof HybridSearchError ||
        err instanceof VectorSearchError ||
        err instanceof KeywordSearchError ||
        err instanceof AdaptiveRetrievalError
      ) {
        res.status(err.statusCode).json({
          error: err.name,
          message: err.message,
          statusCode: err.statusCode,
        });
        return;
      }
      next(err);
    }
  }
);

// Standalone Direct Router for /api/v1/knowledge-spaces/:knowledgeSpaceId/query-understanding
directKnowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/query-understanding',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;

      const spaceRes = await pool.query(
        `SELECT id, workspace_id FROM knowledge_spaces WHERE id = $1 AND status = 'active';`,
        [knowledgeSpaceId]
      );

      if (spaceRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `Knowledge space '${knowledgeSpaceId}' does not exist or is inactive.`,
          statusCode: 404,
        });
        return;
      }

      const workspaceId = spaceRes.rows[0].workspace_id;

      const memberRes = await pool.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, req.user!.id]
      );

      if (memberRes.rows.length === 0) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to the workspace associated with this knowledge space.',
          statusCode: 403,
        });
        return;
      }

      const query = typeof req.body?.query === 'string' ? req.body.query : '';
      if (!query || query.trim().length === 0) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Search query must be a non-empty string.',
          statusCode: 400,
        });
        return;
      }

      const analysis = analyzeQuery(query);
      res.status(200).json({
        status: 'ok',
        ...analysis,
      });
    } catch (err: any) {
      next(err);
    }
  }
);

// Standalone Direct Router for /api/v1/knowledge-spaces/:knowledgeSpaceId/rerank
directKnowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/rerank',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;

      const spaceRes = await pool.query(
        `SELECT id, workspace_id FROM knowledge_spaces WHERE id = $1 AND status = 'active';`,
        [knowledgeSpaceId]
      );

      if (spaceRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `Knowledge space '${knowledgeSpaceId}' does not exist or is inactive.`,
          statusCode: 404,
        });
        return;
      }

      const workspaceId = spaceRes.rows[0].workspace_id;

      const memberRes = await pool.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, req.user!.id]
      );

      if (memberRes.rows.length === 0) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to the workspace associated with this knowledge space.',
          statusCode: 403,
        });
        return;
      }

      const parse = RerankCandidatesSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid rerank parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { query, candidates, model, topK, strategy } = parse.data;
      const mappedCandidates = mapCandidatesToHybridItems(candidates);
      const result = await rerankCandidates(query, mappedCandidates, {
        modelId: model,
        topK,
        strategy,
      });

      res.status(200).json({
        status: 'ok',
        query,
        results: result.results,
        modelId: result.modelId,
        strategyUsed: result.strategyUsed,
        timingMs: result.timingMs,
        rerankedCount: result.results.length,
      });
    } catch (err: any) {
      next(err);
    }
  }
);

// Standalone Direct Router for /api/v1/knowledge-spaces/:knowledgeSpaceId/evaluation/run
directKnowledgeSpacesRouter.post(
  '/:knowledgeSpaceId/evaluation/run',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const knowledgeSpaceId = req.params.knowledgeSpaceId as string;

      const spaceRes = await pool.query(
        `SELECT id, workspace_id FROM knowledge_spaces WHERE id = $1 AND status = 'active';`,
        [knowledgeSpaceId]
      );

      if (spaceRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `Knowledge space '${knowledgeSpaceId}' does not exist or is inactive.`,
          statusCode: 404,
        });
        return;
      }

      const workspaceId = spaceRes.rows[0].workspace_id;

      const memberRes = await pool.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, req.user!.id]
      );

      if (memberRes.rows.length === 0) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to the workspace associated with this knowledge space.',
          statusCode: 403,
        });
        return;
      }

      const callerRole = memberRes.rows[0].role;
      if (!['owner', 'admin', 'analyst'].includes(callerRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Executing retrieval evaluation benchmarks requires Analyst or Admin workspace role.',
          statusCode: 403,
        });
        return;
      }

      const parse = RunEvaluationSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid evaluation parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { datasetPath, dataset, kValues, rerankerModel, strategy } = parse.data;

      const report = await runRetrievalEvaluation({
        workspaceId,
        knowledgeSpaceId,
        datasetPath,
        dataset,
        kValues,
        rerankerModel,
        strategy,
      });

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'retrieval_evaluation_executed',
        resourceType: 'knowledge_space',
        resourceId: knowledgeSpaceId,
        details: {
          datasetVersion: report.datasetVersion,
          queryCount: report.queryCount,
          baseline: report.baseline,
          reranked: report.reranked,
          deltas: report.deltas,
          accessControl: report.accessControl,
        },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        ...report,
      });
    } catch (err: any) {
      next(err);
    }
  }
);





