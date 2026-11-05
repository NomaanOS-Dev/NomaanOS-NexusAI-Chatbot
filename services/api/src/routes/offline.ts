/**
 * NomaanOS Nexus AI - Offline & Air-Gapped Operations API Routes (Day 18)
 *
 * Provides endpoints for:
 * 1. Offline readiness & air-gap status inspection (GET /api/v1/offline/status).
 * 2. Knowledge space export into portable packages (POST /api/v1/offline/export).
 * 3. Knowledge package import with cryptographic SHA-256 verification (POST /api/v1/offline/import).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OfflinePackagerService } from '../services/offline-packager.js';
import { authenticate } from '../middleware/auth.js';
import { pool } from '../database/pool.js';

export const offlineRouter = Router();

const ExportSchema = z.object({
  knowledgeSpaceId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  saveToDisk: z.boolean().default(true),
});

const ImportSchema = z.object({
  targetWorkspaceId: z.string().uuid().optional(),
  package: z.object({
    manifest: z.object({
      version: z.string(),
      packageId: z.string(),
      exportedAt: z.string(),
      sourceWorkspaceId: z.string(),
      knowledgeSpaceName: z.string(),
      knowledgeSpaceSlug: z.string(),
      documentCount: z.number(),
      chunkCount: z.number(),
      embeddingModel: z.string(),
      checksum: z.string(),
    }),
    documents: z.array(z.any()),
  }),
  targetSpaceName: z.string().max(255).optional(),
});

// 1. Offline & Air-Gapped System Readiness Status
// GET /api/v1/offline/status
offlineRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const packager = new OfflinePackagerService();
    const status = await packager.getSystemOfflineStatus();

    res.status(200).json({
      status: 'ok',
      offline: status,
    });
  } catch (err) {
    next(err);
  }
});

// 2. Export Knowledge Space into an Offline Package
// POST /api/v1/offline/export
offlineRouter.post(
  '/export',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = ExportSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid export payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      let workspaceId =
        parse.data.workspaceId ||
        (req.headers['x-workspace-id'] as string) ||
        req.workspace?.id;

      if (!workspaceId) {
        // Look up workspace_id directly from the knowledge space
        const spaceRes = await pool.query(
          `SELECT workspace_id FROM knowledge_spaces WHERE id = $1;`,
          [parse.data.knowledgeSpaceId]
        );
        if (spaceRes.rows.length === 0) {
          res.status(404).json({ error: 'NotFound', message: 'Knowledge space not found', statusCode: 404 });
          return;
        }
        workspaceId = spaceRes.rows[0].workspace_id;
      }

      if (!workspaceId) {
        res.status(400).json({ error: 'BadRequest', message: 'Workspace context required', statusCode: 400 });
        return;
      }

      // Check caller's workspace membership
      if (req.user?.id) {
        const memberCheck = await pool.query(
          `SELECT id, role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
          [workspaceId, req.user.id]
        );
        if (memberCheck.rows.length === 0) {
          res.status(403).json({ error: 'Forbidden', message: 'Access denied to workspace', statusCode: 403 });
          return;
        }
      }

      const packager = new OfflinePackagerService();
      const pkg = await packager.exportKnowledgePackage({
        workspaceId,
        knowledgeSpaceId: parse.data.knowledgeSpaceId,
        saveToDisk: parse.data.saveToDisk,
      });

      res.status(200).json({
        status: 'ok',
        manifest: pkg.manifest,
        package: pkg,
      });
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        res.status(404).json({ error: 'NotFound', message: err.message, statusCode: 404 });
        return;
      }
      next(err);
    }
  }
);

// 3. Import Knowledge Package with SHA-256 Integrity Verification
// POST /api/v1/offline/import
offlineRouter.post(
  '/import',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = ImportSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid import package payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      let workspaceId =
        parse.data.targetWorkspaceId ||
        (req.headers['x-workspace-id'] as string) ||
        req.workspace?.id;

      if (!workspaceId && req.user?.id) {
        const userWs = await pool.query(
          `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1;`,
          [req.user.id]
        );
        if (userWs.rows.length > 0) {
          workspaceId = userWs.rows[0].workspace_id;
        }
      }

      if (!workspaceId) {
        res.status(400).json({ error: 'BadRequest', message: 'Target workspace context required', statusCode: 400 });
        return;
      }

      const packager = new OfflinePackagerService();
      const result = await packager.importKnowledgePackage(parse.data.package as any, {
        targetWorkspaceId: workspaceId,
        targetSpaceName: parse.data.targetSpaceName,
      });

      res.status(201).json({
        status: 'created',
        result,
      });
    } catch (err: any) {
      if (err.message?.includes('checksum') || err.message?.includes('tampered')) {
        res.status(400).json({
          error: 'ChecksumVerificationFailed',
          message: err.message,
          statusCode: 400,
        });
        return;
      }
      next(err);
    }
  }
);

