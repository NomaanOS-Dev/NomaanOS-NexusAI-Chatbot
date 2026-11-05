import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config/env.js';
import {
  getJobById,
  listJobs,
  retryFailedJob,
  cancelJob,
  completeJob,
} from '../services/job-queue.js';
import { generateChunks } from '../services/chunker.js';
import { persistChunkEmbeddings, ChunkToEmbed } from '../services/embedding-service.js';

export const ingestionJobsRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves caller workspace from param, header, query, or token.
 */
async function resolveWorkspace(req: Request): Promise<string> {
  const workspaceId =
    (req.headers['x-workspace-id'] as string) ||
    (req.query.workspaceId as string) ||
    req.workspace?.id;

  if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
    const error: any = new Error('Valid workspace ID is required in x-workspace-id header or workspaceId query parameter.');
    error.statusCode = 400;
    error.name = 'ValidationError';
    throw error;
  }

  // Check caller membership in workspace
  const memberRes = await pool.query(
    `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
    [workspaceId, req.user!.id]
  );

  if (memberRes.rows.length === 0) {
    const error: any = new Error('Workspace not found or access denied.');
    error.statusCode = 404;
    error.name = 'NotFound';
    throw error;
  }

  return workspaceId;
}

/**
 * Checks if user is analyst, admin, or owner in the workspace.
 */
async function requireAnalystRole(workspaceId: string, userId: string) {
  const roleRes = await pool.query(
    `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
    [workspaceId, userId]
  );
  const role = roleRes.rows[0]?.role;
  if (!['analyst', 'admin', 'owner'].includes(role)) {
    const error: any = new Error('Workspace analyst role or higher is required.');
    error.statusCode = 403;
    error.name = 'Forbidden';
    throw error;
  }
}

// -----------------------------------------------------------------------------
// 1. Get Single Ingestion Job
// GET /api/v1/ingestion-jobs/:jobId
// -----------------------------------------------------------------------------
ingestionJobsRouter.get('/:jobId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawJobId = req.params.jobId;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
    if (!jobId || !UUID_REGEX.test(jobId)) {
      res.status(404).json({ error: 'NotFound', message: 'Ingestion job not found.', statusCode: 404 });
      return;
    }

    const workspaceId = await resolveWorkspace(req);
    const job = await getJobById(jobId, workspaceId);

    if (!job) {
      res.status(404).json({ error: 'NotFound', message: 'Ingestion job not found.', statusCode: 404 });
      return;
    }

    res.status(200).json({
      status: 'ok',
      job: {
        id: job.id,
        workspaceId: job.workspaceId,
        knowledgeSpaceId: job.knowledgeSpaceId,
        sourceId: job.sourceId,
        jobType: job.jobType,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        scheduledAt: job.scheduledAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        timeoutSeconds: job.timeoutSeconds,
        errorCode: job.errorCode,
        diagnosticMessage: job.diagnosticMessage,
        correlationId: job.correlationId,
        result: job.result,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 2. List Ingestion Jobs
// GET /api/v1/ingestion-jobs
// -----------------------------------------------------------------------------
ingestionJobsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = await resolveWorkspace(req);
    const sourceId = req.query.sourceId as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const { jobs, total } = await listJobs(workspaceId, { sourceId, status, limit, offset });

    res.status(200).json({
      status: 'ok',
      workspaceId,
      jobs: jobs.map((job) => ({
        id: job.id,
        workspaceId: job.workspaceId,
        knowledgeSpaceId: job.knowledgeSpaceId,
        sourceId: job.sourceId,
        jobType: job.jobType,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        scheduledAt: job.scheduledAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorCode: job.errorCode,
        diagnosticMessage: job.diagnosticMessage,
        result: job.result,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 3. Retry Eligible Failed Job
// POST /api/v1/ingestion-jobs/:jobId/retry
// -----------------------------------------------------------------------------
ingestionJobsRouter.post('/:jobId/retry', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawJobId = req.params.jobId;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
    if (!jobId || !UUID_REGEX.test(jobId)) {
      res.status(404).json({ error: 'NotFound', message: 'Ingestion job not found.', statusCode: 404 });
      return;
    }

    const workspaceId = await resolveWorkspace(req);
    await requireAnalystRole(workspaceId, req.user!.id);

    const retriedJob = await retryFailedJob(jobId, workspaceId);

    res.status(200).json({
      status: 'ok',
      message: 'Job re-queued successfully for execution.',
      job: retriedJob,
    });
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
      return;
    }
    if (err.message && err.message.includes('not eligible')) {
      res.status(400).json({ error: 'InvalidStateTransition', message: err.message, statusCode: 400 });
      return;
    }
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 4. Cancel Active or Queued Job
// POST /api/v1/ingestion-jobs/:jobId/cancel
// -----------------------------------------------------------------------------
ingestionJobsRouter.post('/:jobId/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawJobId = req.params.jobId;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
    if (!jobId || !UUID_REGEX.test(jobId)) {
      res.status(404).json({ error: 'NotFound', message: 'Ingestion job not found.', statusCode: 404 });
      return;
    }

    const workspaceId = await resolveWorkspace(req);
    await requireAnalystRole(workspaceId, req.user!.id);

    const cancelledJob = await cancelJob(jobId, workspaceId);

    res.status(200).json({
      status: 'ok',
      message: 'Job cancelled successfully.',
      job: cancelledJob,
    });
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
      return;
    }
    if (err.message && err.message.includes('cannot be cancelled')) {
      res.status(400).json({ error: 'InvalidStateTransition', message: err.message, statusCode: 400 });
      return;
    }
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 5. Internal Worker Commit Endpoint
// POST /api/v1/internal/ingestion/commit
// -----------------------------------------------------------------------------
export const internalIngestionRouter = Router();

internalIngestionRouter.post('/commit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const internalKey = req.headers['x-internal-key'];
    if (!internalKey || internalKey !== config.worker.internalApiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing internal worker authentication key.',
        statusCode: 401,
      });
      return;
    }

    const {
      jobId,
      workerId,
      sourceId,
      workspaceId,
      knowledgeSpaceId,
      title,
      extractedData,
      normalizedText,
      sha256,
      warnings = [],
      customMetadata = {},
    } = req.body;

    if (!jobId || !workerId || !sourceId || !workspaceId || !knowledgeSpaceId) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Missing required commit fields (jobId, workerId, sourceId, workspaceId, knowledgeSpaceId).',
        statusCode: 400,
      });
      return;
    }

    // 1. Structure-Aware Chunking (reusing Day 7 chunker)
    const chunks = generateChunks(extractedData, normalizedText, title);
    const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);

    // 2. Transactional Version Supersession (reusing Day 7 versioning)
    const client = await pool.connect();
    const newVersionId = crypto.randomUUID();

    try {
      await client.query('BEGIN');

      // Fetch current source record
      const curSourceRes = await client.query(
        `SELECT current_version_id FROM document_sources WHERE id = $1 AND workspace_id = $2 FOR UPDATE;`,
        [sourceId, workspaceId]
      );

      if (curSourceRes.rows.length === 0) {
        throw new Error(`Document source ${sourceId} not found in workspace ${workspaceId}.`);
      }

      const previousVersionId = curSourceRes.rows[0].current_version_id;

      // Determine next version number
      const maxVerRes = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver 
         FROM document_versions WHERE source_id = $1;`,
        [sourceId]
      );
      const nextVersionNumber = maxVerRes.rows[0]?.next_ver || 1;

      // A. Insert new active version first (referencing previousVersionId)
      await client.query(
        `INSERT INTO document_versions (
           id, source_id, version_number, sha256, metadata, extracted_data,
           raw_content, status, is_current, supersedes_version_id, chunk_count, total_tokens
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', TRUE, $8, $9, $10);`,
        [
          newVersionId,
          sourceId,
          nextVersionNumber,
          sha256,
          JSON.stringify(customMetadata || {}),
          JSON.stringify(extractedData || {}),
          normalizedText ? normalizedText.slice(0, 100000) : null,
          previousVersionId || null,
          chunks.length,
          totalTokens,
        ]
      );

      // B. Supersede previous active version(s)
      if (previousVersionId) {
        await client.query(
          `UPDATE document_versions 
           SET is_current = FALSE, status = 'superseded', superseded_by_version_id = $1
           WHERE id = $2;`,
          [newVersionId, previousVersionId]
        );

        // Deactivate chunks of previous version
        await client.query(
          `UPDATE document_chunks SET is_active = FALSE WHERE version_id = $1;`,
          [previousVersionId]
        );
        await client.query(
          `UPDATE chunk_embeddings SET is_active = FALSE WHERE chunk_id IN (SELECT id FROM document_chunks WHERE version_id = $1);`,
          [previousVersionId]
        );
      }

      // C. Persist new chunks with is_active = TRUE
      const insertedChunks: ChunkToEmbed[] = [];
      for (const chunk of chunks) {
        const chunkRes = await client.query(
          `INSERT INTO document_chunks (
             workspace_id, knowledge_space_id, source_id, version_id,
             chunk_index, content, token_count, chunk_hash, section_path,
             page_number, source_offset, is_active, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12)
           RETURNING id, content;`,
          [
            workspaceId,
            knowledgeSpaceId,
            sourceId,
            newVersionId,
            chunk.chunkIndex,
            chunk.content,
            chunk.tokenCount,
            chunk.chunkHash,
            chunk.sectionPath,
            chunk.pageNumber,
            chunk.sourceOffset,
            JSON.stringify(chunk.metadata),
          ]
        );
        if (chunkRes.rows[0]) {
          insertedChunks.push({
            chunkId: chunkRes.rows[0].id,
            workspaceId,
            knowledgeSpaceId,
            content: chunkRes.rows[0].content,
          });
        }
      }

      // D. Update source current version pointer and completed status
      await client.query(
        `UPDATE document_sources
         SET 
           status = $1,
           current_version_id = $2,
           extracted_text = $3,
           extracted_data = $4,
           extraction_warnings = $5,
           error_message = NULL,
           extracted_at = NOW(),
           updated_at = NOW()
         WHERE id = $6;`,
        [
          warnings.length > 0 ? 'completed_with_warnings' : 'completed',
          newVersionId,
          normalizedText,
          JSON.stringify(extractedData || {}),
          JSON.stringify(warnings),
          sourceId,
        ]
      );

      // E. Complete Job
      const resultData = {
        versionId: newVersionId,
        versionNumber: nextVersionNumber,
        chunkCount: chunks.length,
        totalTokens,
        warnings,
      };

      await client.query(
        `UPDATE ingestion_jobs
         SET status = 'completed',
             completed_at = NOW(),
             result = $1,
             locked_by = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $2;`,
        [JSON.stringify(resultData), jobId]
      );

      await client.query('COMMIT');

      // Generate local vector embeddings for newly committed chunks
      if (insertedChunks.length > 0) {
        try {
          await persistChunkEmbeddings(insertedChunks);
        } catch (embErr) {
          logger.warn({ embErr, sourceId, versionId: newVersionId }, 'Deferred or failed chunk embedding generation during internal commit');
        }
      }

      logger.info({ jobId, sourceId, versionId: newVersionId, chunkCount: chunks.length }, 'Internal commit completed');

      res.status(200).json({
        success: true,
        versionId: newVersionId,
        versionNumber: nextVersionNumber,
        chunkCount: chunks.length,
        totalTokens,
        status: 'completed',
      });
    } catch (txnErr) {
      await client.query('ROLLBACK');
      throw txnErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error({ err }, 'Internal worker commit failed');
    next(err);
  }
});

