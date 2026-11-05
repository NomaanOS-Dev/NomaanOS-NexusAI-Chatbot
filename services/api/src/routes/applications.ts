import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import {
  authenticate,
  requireWorkspaceMember,
  requireWorkspaceAdmin,
  requireWorkspaceViewer,
} from '../middleware/auth.js';
import { recordAuditEvent } from '../services/audit-service.js';

export const applicationsRouter = Router({ mergeParams: true });

const CreateAppSchema = z.object({
  name: z.string().min(2).max(255),
  appKey: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z0-9_\-]+$/i, {
      message: 'App key must contain alphanumeric, underscore, or hyphen characters',
    }),
  allowedOrigins: z.array(z.string().url()).optional().default([]),
});

// 1. Create Application (Admin+)
applicationsRouter.post(
  '/',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = CreateAppSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid application parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { name, appKey, allowedOrigins } = parse.data;
      const workspaceId = req.workspace!.id;

      // Unique check per workspace
      const existing = await pool.query(
        `SELECT id FROM applications WHERE workspace_id = $1 AND app_key = $2;`,
        [workspaceId, appKey]
      );
      if (existing.rows.length > 0) {
        res.status(409).json({
          error: 'Conflict',
          message: `Application with key "${appKey}" already exists in this workspace.`,
          statusCode: 409,
        });
        return;
      }

      const insertRes = await pool.query(
        `INSERT INTO applications (workspace_id, name, app_key, allowed_origins)
         VALUES ($1, $2, $3, $4)
         RETURNING id, workspace_id, name, app_key, status, allowed_origins, created_at;`,
        [workspaceId, name, appKey, allowedOrigins]
      );

      const application = insertRes.rows[0];

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'application_created',
        resourceType: 'application',
        resourceId: application.id,
        details: { name, appKey },
        ipAddress: req.ip,
      });

      res.status(201).json({
        status: 'ok',
        application: {
          id: application.id,
          workspaceId: application.workspace_id,
          workspace_id: application.workspace_id,
          name: application.name,
          appKey: application.app_key,
          status: application.status,
          allowedOrigins: application.allowed_origins,
          createdAt: application.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. List Applications for Workspace (Viewer+)
applicationsRouter.get(
  '/',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const query = `
        SELECT id, workspace_id, name, app_key, status, allowed_origins, created_at, updated_at
        FROM applications
        WHERE workspace_id = $1
        ORDER BY created_at DESC;
      `;
      const result = await pool.query(query, [workspaceId]);
      res.status(200).json({ status: 'ok', applications: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 3. Get Application Details (Viewer+, Tenant-Scoped)
applicationsRouter.get(
  '/:applicationId',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const applicationId = req.params.applicationId;

      if (typeof applicationId !== 'string' || !UUID_REGEX.test(applicationId)) {
        res.status(404).json({ error: 'NotFound', message: 'Application not found.', statusCode: 404 });
        return;
      }

      const query = `
        SELECT id, workspace_id, name, app_key, status, allowed_origins, created_at, updated_at
        FROM applications
        WHERE id = $1 AND workspace_id = $2;
      `;
      const result = await pool.query(query, [applicationId, workspaceId]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Application not found.', statusCode: 404 });
        return;
      }

      res.status(200).json({ status: 'ok', application: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Delete Application (Admin+, Tenant-Scoped)
applicationsRouter.delete(
  '/:applicationId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const applicationId = req.params.applicationId;

      if (typeof applicationId !== 'string' || !UUID_REGEX.test(applicationId)) {
        res.status(404).json({ error: 'NotFound', message: 'Application not found.', statusCode: 404 });
        return;
      }

      const deleteRes = await pool.query(
        `DELETE FROM applications WHERE id = $1 AND workspace_id = $2 RETURNING id, name;`,
        [applicationId, workspaceId]
      );

      if (deleteRes.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Application not found.', statusCode: 404 });
        return;
      }

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'application_deleted',
        resourceType: 'application',
        resourceId: applicationId,
        details: { name: deleteRes.rows[0].name },
        ipAddress: req.ip,
      });

      res.status(200).json({ status: 'ok', message: 'Application deleted successfully.' });
    } catch (err) {
      next(err);
    }
  }
);
