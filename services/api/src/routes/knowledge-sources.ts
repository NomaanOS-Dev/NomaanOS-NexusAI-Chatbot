import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import {
  authenticate,
  requireWorkspaceAnalyst,
  requireWorkspaceViewer,
  requireWorkspaceAdmin,
} from '../middleware/auth.js';
import { config } from '../config/env.js';
import {
  processDocumentUpload,
  updateDocumentSource,
  DocumentProcessingError,
} from '../services/document-processor.js';
import { recordAuditEvent } from '../services/audit-service.js';
import { createIngestionJob } from '../services/job-queue.js';

export const knowledgeSourcesRouter = Router({ mergeParams: true });

// Configure secure memory storage upload handler
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileBytes,
    files: 1,
  },
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves caller workspace from param, header, or query, and checks membership.
 */
async function resolveCallerWorkspace(req: Request): Promise<string> {
  const workspaceId =
    (req.params.workspaceId as string) ||
    (req.headers['x-workspace-id'] as string) ||
    (req.query.workspaceId as string) ||
    req.workspace?.id;

  if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
    const error: any = new Error('Valid workspace ID is required in route params, header, or query.');
    error.statusCode = 400;
    error.name = 'ValidationError';
    throw error;
  }

  // Verify caller is a member of this workspace
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
 * Verifies that a knowledge space belongs to the specified workspace.
 */
async function verifyKnowledgeSpace(knowledgeSpaceId: string, workspaceId: string) {
  if (!UUID_REGEX.test(knowledgeSpaceId)) {
    const error: any = new Error('Invalid knowledge space ID.');
    error.statusCode = 404;
    error.name = 'NotFound';
    throw error;
  }

  const spaceRes = await pool.query(
    `SELECT id, name, slug FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
    [knowledgeSpaceId, workspaceId]
  );

  if (spaceRes.rows.length === 0) {
    const error: any = new Error('Knowledge space not found in this workspace.');
    error.statusCode = 404;
    error.name = 'NotFound';
    throw error;
  }

  return spaceRes.rows[0];
}

/**
 * Verifies that an assistant belongs to the specified workspace if provided.
 */
async function verifyAssistant(assistantId: string | undefined, workspaceId: string) {
  if (!assistantId) return null;

  if (!UUID_REGEX.test(assistantId)) {
    const error: any = new Error('Invalid assistant ID format.');
    error.statusCode = 400;
    error.name = 'ValidationError';
    throw error;
  }

  const asstRes = await pool.query(
    `SELECT id, name FROM assistants WHERE id = $1 AND workspace_id = $2;`,
    [assistantId, workspaceId]
  );

  if (asstRes.rows.length === 0) {
    const error: any = new Error('Assistant not found in this workspace.');
    error.statusCode = 404;
    error.name = 'NotFound';
    throw error;
  }

  return asstRes.rows[0];
}

// -----------------------------------------------------------------------------
// 1. Register & Upload Knowledge Source
// POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/sources
// POST /api/v1/knowledge-sources
// -----------------------------------------------------------------------------
const uploadMiddleware = upload.single('file');

export async function handleSourceUpload(req: Request, res: Response, next: NextFunction) {
  uploadMiddleware(req, res, async (multerErr: any) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: 'PayloadTooLarge',
            message: `File size exceeds maximum permitted limit of ${config.upload.maxFileBytes} bytes.`,
            statusCode: 413,
          });
          return;
        }
        res.status(400).json({
          error: 'UploadError',
          message: multerErr.message || 'File upload error',
          statusCode: 400,
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          error: 'ValidationError',
          message: "A document file must be uploaded under the 'file' multipart field.",
          statusCode: 400,
        });
        return;
      }

      const workspaceId = await resolveCallerWorkspace(req);

      // Resolve knowledgeSpaceId: from URL params or body
      const knowledgeSpaceId =
        (req.params.knowledgeSpaceId as string) || (req.body.knowledgeSpaceId as string);

      if (!knowledgeSpaceId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'knowledgeSpaceId is required in URL or form field.',
          statusCode: 400,
        });
        return;
      }

      // Verify knowledge space exists in workspace
      await verifyKnowledgeSpace(knowledgeSpaceId, workspaceId);

      // Verify assistant belongs to workspace if supplied
      const assistantId = req.body.assistantId || null;
      if (assistantId) {
        await verifyAssistant(assistantId, workspaceId);
      }

      // Check caller role in workspace (must be analyst, admin, or owner)
      const roleRes = await pool.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, req.user!.id]
      );
      const role = roleRes.rows[0]?.role;
      if (!['analyst', 'admin', 'owner'].includes(role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Workspace analyst role or higher is required to upload document sources.',
          statusCode: 403,
        });
        return;
      }

      // Parse optional metadata JSON string
      let customMetadata: Record<string, any> = {};
      const rawMetadata = req.body.metadata || req.body.customMetadata;
      if (rawMetadata) {
        try {
          customMetadata =
            typeof rawMetadata === 'string'
              ? JSON.parse(rawMetadata)
              : rawMetadata;
        } catch {
          // ignore or record raw
          customMetadata = { raw: rawMetadata };
        }
      }

      const result = await processDocumentUpload({
        workspaceId,
        knowledgeSpaceId,
        assistantId,
        actorId: req.user!.id,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        declaredMimeType: req.file.mimetype,
        titleOverride: req.body.title || req.body.name,
        customMetadata,
      });

      res.status(201).json({
        status: 'ok',
        source: {
          id: result.sourceId,
          workspaceId: result.workspaceId,
          knowledgeSpaceId: result.knowledgeSpaceId,
          assistantId: result.assistantId,
          title: result.title,
          filename: result.filename,
          mimeType: result.mimeType,
          fileSizeBytes: result.fileSizeBytes,
          sha256: result.sha256,
          status: result.status,
          warnings: result.warnings,
          errorMessage: result.errorMessage,
          versionId: result.versionId,
          versionNumber: result.versionNumber,
          chunkCount: result.chunkCount,
          totalTokens: result.totalTokens,
          isDuplicate: result.isDuplicate || false,
          duplicateOfSourceId: result.duplicateOfSourceId,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        },
        extraction: {
          status: result.status,
          warnings: result.warnings,
          characterCount: result.extractedText.length,
          blocksCount: result.extractedData?.blocks?.length || 0,
          chunkCount: result.chunkCount,
          totalTokens: result.totalTokens,
        },
      });
    } catch (err: any) {
      if (err instanceof DocumentProcessingError || err.statusCode) {
        res.status(err.statusCode || 400).json({
          error: err.name || 'DocumentProcessingError',
          message: err.message,
          statusCode: err.statusCode || 400,
          details: err.details,
        });
        return;
      }
      next(err);
    }
  });
}

knowledgeSourcesRouter.post('/', authenticate, handleSourceUpload);

// -----------------------------------------------------------------------------
// 2. List Knowledge Sources (Viewer+)
// GET /api/v1/knowledge-sources
// -----------------------------------------------------------------------------
knowledgeSourcesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = await resolveCallerWorkspace(req);
    const knowledgeSpaceId = req.query.knowledgeSpaceId as string | undefined;
    const assistantId = req.query.assistantId as string | undefined;
    const status = req.query.status as string | undefined;

    let query = `
      SELECT 
        ds.id, ds.workspace_id, ds.knowledge_space_id, ds.assistant_id,
        ds.title, ds.filename, ds.mime_type, ds.file_size_bytes, ds.sha256,
        ds.status, ds.extraction_warnings, ds.error_message, ds.metadata,
        ds.extracted_at, ds.created_at, ds.updated_at,
        ks.name AS knowledge_space_name,
        a.name AS assistant_name
      FROM document_sources ds
      JOIN knowledge_spaces ks ON ds.knowledge_space_id = ks.id
      LEFT JOIN assistants a ON ds.assistant_id = a.id
      WHERE ds.workspace_id = $1
    `;
    const params: any[] = [workspaceId];

    if (knowledgeSpaceId && UUID_REGEX.test(knowledgeSpaceId)) {
      params.push(knowledgeSpaceId);
      query += ` AND ds.knowledge_space_id = $${params.length}`;
    }

    if (assistantId && UUID_REGEX.test(assistantId)) {
      params.push(assistantId);
      query += ` AND ds.assistant_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND ds.status = $${params.length}`;
    }

    query += ` ORDER BY ds.created_at DESC;`;

    const result = await pool.query(query, params);

    res.status(200).json({
      status: 'ok',
      sources: result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        knowledgeSpaceId: row.knowledge_space_id,
        knowledgeSpaceName: row.knowledge_space_name,
        assistantId: row.assistant_id,
        assistantName: row.assistant_name,
        title: row.title,
        filename: row.filename,
        mimeType: row.mime_type,
        fileSizeBytes: Number(row.file_size_bytes),
        sha256: row.sha256,
        status: row.status,
        warnings: row.extraction_warnings || [],
        errorMessage: row.error_message,
        metadata: row.metadata,
        extractedAt: row.extracted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: result.rows.length,
    });
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
      return;
    }
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 3. Get Knowledge Source by ID (Viewer+)
// GET /api/v1/knowledge-sources/:sourceId
// -----------------------------------------------------------------------------
knowledgeSourcesRouter.get('/:sourceId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSourceId = req.params.sourceId;
    const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
    if (!sourceId || !UUID_REGEX.test(sourceId)) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    // Tenant-isolated query: only return if caller is member of owning workspace
    const query = `
      SELECT 
        ds.id, ds.workspace_id, ds.knowledge_space_id, ds.assistant_id,
        ds.title, ds.filename, ds.mime_type, ds.file_size_bytes, ds.sha256,
        ds.status, ds.extracted_text, ds.extracted_data, ds.extraction_warnings,
        ds.error_message, ds.metadata, ds.extracted_at, ds.created_at, ds.updated_at,
        ks.name AS knowledge_space_name,
        a.name AS assistant_name,
        wm.role AS caller_role
      FROM document_sources ds
      JOIN knowledge_spaces ks ON ds.knowledge_space_id = ks.id
      LEFT JOIN assistants a ON ds.assistant_id = a.id
      LEFT JOIN workspace_memberships wm 
        ON ds.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE ds.id = $1;
    `;

    const result = await pool.query(query, [sourceId, req.user!.id]);
    if (result.rows.length === 0 || !result.rows[0].caller_role) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    const row = result.rows[0];

    // Query versions
    const versionsRes = await pool.query(
      `SELECT id, version_number, sha256, metadata, created_at
       FROM document_versions
       WHERE source_id = $1
       ORDER BY version_number ASC;`,
      [sourceId]
    );

    res.status(200).json({
      status: 'ok',
      source: {
        id: row.id,
        workspaceId: row.workspace_id,
        knowledgeSpaceId: row.knowledge_space_id,
        knowledgeSpaceName: row.knowledge_space_name,
        assistantId: row.assistant_id,
        assistantName: row.assistant_name,
        title: row.title,
        filename: row.filename,
        mimeType: row.mime_type,
        fileSizeBytes: Number(row.file_size_bytes),
        sha256: row.sha256,
        status: row.status,
        extractedTextPreview: row.extracted_text ? row.extracted_text.slice(0, 1000) : '',
        extractedData: row.extracted_data,
        warnings: row.extraction_warnings || [],
        errorMessage: row.error_message,
        metadata: row.metadata,
        versions: versionsRes.rows,
        extractedAt: row.extracted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 4. Delete Knowledge Source (Admin+)
// DELETE /api/v1/knowledge-sources/:sourceId
// -----------------------------------------------------------------------------
knowledgeSourcesRouter.delete('/:sourceId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSourceId = req.params.sourceId;
    const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
    if (!sourceId || !UUID_REGEX.test(sourceId)) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    // Verify workspace admin permission
    const checkQuery = `
      SELECT ds.id, ds.workspace_id, ds.title, ds.filename, ds.storage_path, wm.role
      FROM document_sources ds
      JOIN workspace_memberships wm 
        ON ds.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE ds.id = $1;
    `;
    const checkRes = await pool.query(checkQuery, [sourceId, req.user!.id]);

    if (checkRes.rows.length === 0) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    const { workspace_id, title, storage_path, role } = checkRes.rows[0];
    if (!['admin', 'owner'].includes(role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Workspace admin role or higher is required to delete knowledge sources.',
        statusCode: 403,
      });
      return;
    }

    // Delete record (CASCADE removes versions and chunks)
    await pool.query('DELETE FROM document_sources WHERE id = $1;', [sourceId]);

    // Clean up file from private disk storage if exists
    try {
      if (storage_path && fs.existsSync(storage_path)) {
        fs.unlinkSync(storage_path);
      }
    } catch (diskErr) {
      logger.warn({ diskErr, storage_path }, 'Could not unlink raw document storage file');
    }

    await recordAuditEvent({
      workspaceId: workspace_id,
      actorId: req.user!.id,
      action: 'document_source_deleted',
      resourceType: 'document_source',
      resourceId: sourceId,
      details: { title },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: 'ok',
      message: 'Knowledge source successfully deleted.',
      sourceId,
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 5. Update Knowledge Source (Analyst+) -> Creates Version N+1 with Supersession
// PUT /api/v1/knowledge-sources/:sourceId
// POST /api/v1/knowledge-sources/:sourceId/versions
// -----------------------------------------------------------------------------
const handleUpdateSource = (req: Request, res: Response, next: NextFunction) => {
  uploadMiddleware(req, res, async (multerErr: any) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: 'PayloadTooLarge',
            message: `File size exceeds maximum permitted limit of ${config.upload.maxFileBytes} bytes.`,
            statusCode: 413,
          });
          return;
        }
        res.status(400).json({
          error: 'UploadError',
          message: multerErr.message || 'File upload error',
          statusCode: 400,
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          error: 'ValidationError',
          message: "An updated document file must be uploaded under the 'file' multipart field.",
          statusCode: 400,
        });
        return;
      }

      const rawSourceId = req.params.sourceId;
      const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
      if (!sourceId || !UUID_REGEX.test(sourceId)) {
        res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
        return;
      }

      // Verify workspace membership and role
      const checkQuery = `
        SELECT ds.id, ds.workspace_id, wm.role
        FROM document_sources ds
        JOIN workspace_memberships wm 
          ON ds.workspace_id = wm.workspace_id AND wm.user_id = $2
        WHERE ds.id = $1;
      `;
      const checkRes = await pool.query(checkQuery, [sourceId, req.user!.id]);
      if (checkRes.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found in this workspace.', statusCode: 404 });
        return;
      }

      const { workspace_id, role } = checkRes.rows[0];
      if (!['analyst', 'admin', 'owner'].includes(role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Workspace analyst role or higher is required to update document sources.',
          statusCode: 403,
        });
        return;
      }

      let customMetadata: Record<string, any> = {};
      const rawUpdateMeta = req.body.metadata || req.body.customMetadata;
      if (rawUpdateMeta) {
        try {
          customMetadata = typeof rawUpdateMeta === 'string' ? JSON.parse(rawUpdateMeta) : rawUpdateMeta;
        } catch {
          customMetadata = { raw: rawUpdateMeta };
        }
      }

      const updateResult = await updateDocumentSource({
        sourceId,
        workspaceId: workspace_id,
        actorId: req.user!.id,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        declaredMimeType: req.file.mimetype,
        titleOverride: req.body.title || req.body.name,
        customMetadata,
      });

      res.status(200).json({
        status: 'ok',
        update: updateResult,
        version: {
          id: updateResult.versionId,
          versionNumber: updateResult.versionNumber,
          chunkCount: updateResult.chunkCount,
        },
      });
    } catch (err: any) {
      if (err instanceof DocumentProcessingError || err.statusCode) {
        res.status(err.statusCode || 400).json({
          error: err.name || 'DocumentProcessingError',
          message: err.message,
          statusCode: err.statusCode || 400,
          details: err.details,
        });
        return;
      }
      next(err);
    }
  });
};

knowledgeSourcesRouter.put('/:sourceId', authenticate, handleUpdateSource);
knowledgeSourcesRouter.post('/:sourceId/versions', authenticate, handleUpdateSource);

// -----------------------------------------------------------------------------
// 5.5 Enqueue Asynchronous Synchronization Job (Analyst+)
// POST /api/v1/knowledge-sources/:sourceId/sync
// -----------------------------------------------------------------------------
knowledgeSourcesRouter.post('/:sourceId/sync', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSourceId = req.params.sourceId;
    const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
    if (!sourceId || !UUID_REGEX.test(sourceId)) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    // Verify workspace access and role
    const checkQuery = `
      SELECT ds.*, wm.role
      FROM document_sources ds
      JOIN workspace_memberships wm 
        ON ds.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE ds.id = $1;
    `;
    const checkRes = await pool.query(checkQuery, [sourceId, req.user!.id]);
    if (checkRes.rows.length === 0 || !checkRes.rows[0].role) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    const source = checkRes.rows[0];
    if (!['analyst', 'admin', 'owner'].includes(source.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Workspace analyst role or higher is required to synchronize knowledge sources.',
        statusCode: 403,
      });
      return;
    }

    const idempotencyKey = (req.body.idempotencyKey as string) || req.headers['idempotency-key'] as string || null;
    const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();

    const { job, isDuplicate } = await createIngestionJob({
      workspaceId: source.workspace_id,
      knowledgeSpaceId: source.knowledge_space_id,
      sourceId: source.id,
      jobType: source.source_type === 'file' ? 'document_ingest' : 'source_sync',
      payload: {
        storagePath: source.storage_path,
        filename: source.filename,
        mimeType: source.mime_type,
        title: source.title,
        metadata: source.metadata,
      },
      idempotencyKey,
      correlationId,
    });

    res.status(202).json({
      status: 'queued',
      message: isDuplicate
        ? 'Active synchronization job already exists for this request.'
        : 'Synchronization job enqueued successfully.',
      job: {
        id: job.id,
        workspaceId: job.workspaceId,
        sourceId: job.sourceId,
        jobType: job.jobType,
        status: job.status,
        attempts: job.attempts,
        scheduledAt: job.scheduledAt,
        isDuplicate,
      },
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 6. List Document Versions (Viewer+)
// GET /api/v1/knowledge-sources/:sourceId/versions
// -----------------------------------------------------------------------------
knowledgeSourcesRouter.get('/:sourceId/versions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSourceId = req.params.sourceId;
    const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
    if (!sourceId || !UUID_REGEX.test(sourceId)) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    // Tenant check
    const checkQuery = `
      SELECT ds.id, wm.role
      FROM document_sources ds
      JOIN workspace_memberships wm 
        ON ds.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE ds.id = $1;
    `;
    const checkRes = await pool.query(checkQuery, [sourceId, req.user!.id]);
    if (checkRes.rows.length === 0 || !checkRes.rows[0].role) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    const versionsRes = await pool.query(
      `SELECT 
         id, source_id, version_number, sha256, status, is_current,
         supersedes_version_id, superseded_by_version_id,
         chunk_count, total_tokens, metadata, created_at
       FROM document_versions
       WHERE source_id = $1
       ORDER BY version_number DESC;`,
      [sourceId]
    );

    res.status(200).json({
      status: 'ok',
      sourceId,
      versions: versionsRes.rows.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        sha256: v.sha256,
        status: v.status,
        isCurrent: v.is_current,
        supersedesVersionId: v.supersedes_version_id,
        supersededByVersionId: v.superseded_by_version_id,
        chunkCount: v.chunk_count,
        totalTokens: v.total_tokens,
        metadata: v.metadata,
        createdAt: v.created_at,
      })),
      total: versionsRes.rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 7. List Structure-Aware Chunks (Viewer+)
// GET /api/v1/knowledge-sources/:sourceId/chunks
// -----------------------------------------------------------------------------
knowledgeSourcesRouter.get('/:sourceId/chunks', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSourceId = req.params.sourceId;
    const sourceId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
    if (!sourceId || !UUID_REGEX.test(sourceId)) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    // Tenant check
    const checkQuery = `
      SELECT ds.id, ds.workspace_id, ds.knowledge_space_id, ds.current_version_id, wm.role
      FROM document_sources ds
      JOIN workspace_memberships wm 
        ON ds.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE ds.id = $1;
    `;
    const checkRes = await pool.query(checkQuery, [sourceId, req.user!.id]);
    if (checkRes.rows.length === 0 || !checkRes.rows[0].role) {
      res.status(404).json({ error: 'NotFound', message: 'Knowledge source not found.', statusCode: 404 });
      return;
    }

    const { current_version_id } = checkRes.rows[0];
    const rawVersionId = req.query.versionId as string | undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    let query = `
      SELECT 
        dc.id, dc.workspace_id, dc.knowledge_space_id, dc.source_id, dc.version_id,
        dc.chunk_index, dc.content, dc.token_count, dc.chunk_hash, dc.section_path,
        dc.page_number, dc.source_offset, dc.is_active, dc.metadata, dc.created_at,
        dv.version_number
      FROM document_chunks dc
      JOIN document_versions dv ON dc.version_id = dv.id
      WHERE dc.source_id = $1
    `;
    const params: any[] = [sourceId];

    if (rawVersionId && UUID_REGEX.test(rawVersionId)) {
      params.push(rawVersionId);
      query += ` AND dc.version_id = $${params.length}`;
    }

    if (activeOnly) {
      query += ` AND dc.is_active = TRUE`;
    }

    query += ` ORDER BY dc.chunk_index ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2};`;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*)::int AS count 
      FROM document_chunks 
      WHERE source_id = $1 ${rawVersionId && UUID_REGEX.test(rawVersionId) ? `AND version_id = '${rawVersionId}'` : ''} ${activeOnly ? 'AND is_active = TRUE' : ''};
    `;

    const [chunksRes, countRes] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, [sourceId]),
    ]);

    res.status(200).json({
      status: 'ok',
      sourceId,
      versionId: rawVersionId || current_version_id || null,
      chunks: chunksRes.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        knowledgeSpaceId: row.knowledge_space_id,
        sourceId: row.source_id,
        versionId: row.version_id,
        versionNumber: row.version_number,
        chunkIndex: row.chunk_index,
        content: row.content,
        tokenCount: row.token_count,
        chunkHash: row.chunk_hash,
        sectionPath: row.section_path,
        pageNumber: row.page_number,
        sourceOffset: row.source_offset,
        isActive: row.is_active,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
      total: countRes.rows[0]?.count || 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

