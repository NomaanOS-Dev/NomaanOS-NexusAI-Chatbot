/**
 * NomaanOS Nexus AI - User Preferences & Retention Policies API Routes (Day 15)
 *
 * Provides endpoints for:
 * 1. Managing persistent user preferences (GET, PUT, DELETE /api/v1/users/me/preferences).
 * 2. Configuring workspace memory retention policies (GET, PUT /api/v1/workspaces/:workspaceId/retention).
 * 3. Triggering retention purges for expired memory.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { authenticate, requireWorkspaceMember } from '../middleware/auth.js';
import {
  getUserPreferences,
  setUserPreferences,
  deleteUserPreferences,
} from '../services/user-preferences.js';
import { purgeExpiredMemory } from '../services/conversation-memory.js';

export const preferencesRouter = Router();

const UpdatePreferencesSchema = z.object({
  language: z.string().min(2).max(16).optional(),
  responseStyle: z.enum(['concise', 'detailed', 'standard', 'bullet_points', 'executive']).optional(),
  codeTheme: z.string().max(32).optional(),
  customInstructions: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  workspaceId: z.string().uuid().optional(),
});

const UpdateRetentionSchema = z.object({
  conversationRetentionDays: z.number().int().min(1).max(3650).optional(),
  summaryRetentionDays: z.number().int().min(1).max(3650).optional(),
  preferencesRetentionDays: z.number().int().min(1).max(3650).optional(),
  autoPurgeEnabled: z.boolean().optional(),
});

// 1. Get Current User Preferences
// GET /api/v1/users/me/preferences
preferencesRouter.get(
  '/me/preferences',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

      const prefs = await getUserPreferences(userId, workspaceId);
      res.status(200).json({
        status: 'ok',
        preferences: prefs,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Update Current User Preferences
// PUT /api/v1/users/me/preferences
preferencesRouter.put(
  '/me/preferences',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const parse = UpdatePreferencesSchema.safeParse(req.body);

      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid preferences payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { workspaceId, ...prefsInput } = parse.data;
      const updated = await setUserPreferences(userId, prefsInput, workspaceId);

      res.status(200).json({
        status: 'ok',
        preferences: updated,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Delete / Reset User Preferences
// DELETE /api/v1/users/me/preferences
preferencesRouter.delete(
  '/me/preferences',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

      const deleted = await deleteUserPreferences(userId, workspaceId);
      res.status(200).json({
        status: 'ok',
        deleted,
        message: deleted ? 'Preferences successfully deleted' : 'No stored preferences found',
      });
    } catch (err) {
      next(err);
    }
  }
);

export const retentionRouter = Router();

// 4. Get Workspace Retention Policy
// GET /api/v1/workspaces/:workspaceId/retention
retentionRouter.get(
  '/:workspaceId/retention',
  authenticate,
  requireWorkspaceMember(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params.workspaceId as string;

      const policyRes = await pool.query(
        `SELECT workspace_id, conversation_retention_days, summary_retention_days, preferences_retention_days, auto_purge_enabled, created_at, updated_at
         FROM workspace_retention_policies
         WHERE workspace_id = $1::uuid;`,
        [workspaceId]
      );

      if (policyRes.rows.length === 0) {
        // Return platform default policy
        res.status(200).json({
          status: 'ok',
          policy: {
            workspaceId,
            conversationRetentionDays: 90,
            summaryRetentionDays: 180,
            preferencesRetentionDays: 365,
            autoPurgeEnabled: true,
          },
        });
        return;
      }

      const row = policyRes.rows[0];
      res.status(200).json({
        status: 'ok',
        policy: {
          workspaceId: row.workspace_id,
          conversationRetentionDays: row.conversation_retention_days,
          summaryRetentionDays: row.summary_retention_days,
          preferencesRetentionDays: row.preferences_retention_days,
          autoPurgeEnabled: row.auto_purge_enabled,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Update Workspace Retention Policy
// PUT /api/v1/workspaces/:workspaceId/retention
retentionRouter.put(
  '/:workspaceId/retention',
  authenticate,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const parse = UpdateRetentionSchema.safeParse(req.body);

      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid retention policy payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const {
        conversationRetentionDays = 90,
        summaryRetentionDays = 180,
        preferencesRetentionDays = 365,
        autoPurgeEnabled = true,
      } = parse.data;

      const upsertQuery = `
        INSERT INTO workspace_retention_policies (
          workspace_id, conversation_retention_days, summary_retention_days, preferences_retention_days, auto_purge_enabled, updated_at
        ) VALUES ($1::uuid, $2, $3, $4, $5, NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
          conversation_retention_days = EXCLUDED.conversation_retention_days,
          summary_retention_days = EXCLUDED.summary_retention_days,
          preferences_retention_days = EXCLUDED.preferences_retention_days,
          auto_purge_enabled = EXCLUDED.auto_purge_enabled,
          updated_at = NOW()
        RETURNING workspace_id, conversation_retention_days, summary_retention_days, preferences_retention_days, auto_purge_enabled, created_at, updated_at;
      `;

      const resUpsert = await pool.query(upsertQuery, [
        workspaceId,
        conversationRetentionDays,
        summaryRetentionDays,
        preferencesRetentionDays,
        autoPurgeEnabled,
      ]);

      const row = resUpsert.rows[0];
      res.status(200).json({
        status: 'ok',
        policy: {
          workspaceId: row.workspace_id,
          conversationRetentionDays: row.conversation_retention_days,
          summaryRetentionDays: row.summary_retention_days,
          preferencesRetentionDays: row.preferences_retention_days,
          autoPurgeEnabled: row.auto_purge_enabled,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 6. Manual Retention Purge
// POST /api/v1/workspaces/:workspaceId/retention/purge
retentionRouter.post(
  '/:workspaceId/retention/purge',
  authenticate,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const purgeResult = await purgeExpiredMemory({ workspaceId });

      res.status(200).json({
        status: 'ok',
        purged: purgeResult,
      });
    } catch (err) {
      next(err);
    }
  }
);
