import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import {
  authenticate,
  requireWorkspaceMember,
  requireWorkspaceAdmin,
  isRoleSufficient,
  WorkspaceRole,
} from '../middleware/auth.js';
import { recordAuditEvent } from '../services/audit-service.js';

export const workspacesRouter = Router();

const CreateWorkspaceSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Slug must contain lowercase letters, numbers, and hyphens',
    })
    .optional(),
  organizationId: z.string().uuid().optional(),
});

const AddMemberSchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.string().uuid().optional(),
    role: z.enum(['owner', 'admin', 'analyst', 'viewer']),
  })
  .refine((data) => data.email || data.userId, {
    message: 'Either email or userId must be provided',
  });

const UpdateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'analyst', 'viewer']),
});

// 1. List user's workspaces
workspacesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const query = `
      SELECT 
        w.id, w.name, w.slug, w.organization_id, w.status, w.created_at,
        wm.role, wm.created_at AS joined_at
      FROM workspaces w
      JOIN workspace_memberships wm ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
      ORDER BY w.name ASC;
    `;
    const result = await pool.query(query, [user.id]);
    res.status(200).json({ status: 'ok', workspaces: result.rows });
  } catch (err) {
    next(err);
  }
});

// 2. Create a new workspace
workspacesRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parse = CreateWorkspaceSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid workspace parameters',
        statusCode: 400,
        details: parse.error.issues,
      });
      return;
    }

    const { name, organizationId } = parse.data;
    let orgId = organizationId;

    await client.query('BEGIN');

    // If orgId not provided, find user's existing organization or create one
    if (!orgId) {
      const existingOrg = await client.query(
        `SELECT o.id FROM organizations o
         JOIN workspaces w ON o.id = w.organization_id
         JOIN workspace_memberships wm ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 LIMIT 1;`,
        [req.user!.id]
      );

      if (existingOrg.rows.length > 0) {
        orgId = existingOrg.rows[0].id;
      } else {
        const newOrg = await client.query(
          `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id;`,
          [`${req.user!.email.split('@')[0]}'s Organization`, `org-${Date.now()}`]
        );
        orgId = newOrg.rows[0].id;
      }
    }

    const slug = parse.data.slug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;

    // Create workspace
    const wsRes = await client.query(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING id, organization_id, name, slug, status, created_at;`,
      [orgId, name, slug]
    );
    const workspace = wsRes.rows[0];

    // Creator becomes owner
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [workspace.id, req.user!.id]
    );

    await client.query('COMMIT');

    await recordAuditEvent({
      workspaceId: workspace.id,
      actorId: req.user!.id,
      action: 'workspace_created',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: { name: workspace.name },
      ipAddress: req.ip,
    });

    res.status(201).json({
      status: 'created',
      workspace: {
        ...workspace,
        role: 'owner',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 3. Get single workspace details
workspacesRouter.get(
  '/:workspaceId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      workspace: {
        ...req.workspace,
        role: req.membership!.role,
      },
    });
  }
);

// 4. List workspace members
workspacesRouter.get(
  '/:workspaceId/members',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const query = `
        SELECT 
          wm.id, wm.workspace_id, wm.role, wm.created_at,
          u.id AS user_id, u.email, u.full_name
        FROM workspace_memberships wm
        JOIN users u ON wm.user_id = u.id
        WHERE wm.workspace_id = $1
        ORDER BY wm.role ASC, wm.created_at ASC;
      `;
      const result = await pool.query(query, [workspaceId]);
      res.status(200).json({ status: 'ok', members: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Add member to workspace
workspacesRouter.post(
  '/:workspaceId/members',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = AddMemberSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid member parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { email, userId, role } = parse.data;
      const workspaceId = req.workspace!.id;
      const callerRole = req.membership!.role;

      // Role escalation protection: cannot assign a role higher than own role
      if (!isRoleSufficient(callerRole, role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Cannot assign role "${role}". You can only assign roles up to your current privilege level (${callerRole}).`,
          statusCode: 403,
        });
        return;
      }

      // Check if user exists
      let targetUser: { id: string; email: string; full_name: string | null };
      if (userId) {
        const userRes = await pool.query('SELECT id, email, full_name FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
          res.status(404).json({
            error: 'NotFound',
            message: `User with id "${userId}" not found.`,
            statusCode: 404,
          });
          return;
        }
        targetUser = userRes.rows[0];
      } else {
        const userRes = await pool.query('SELECT id, email, full_name FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        if (userRes.rows.length === 0) {
          res.status(404).json({
            error: 'NotFound',
            message: `User with email "${email}" not found. The user must register first.`,
            statusCode: 404,
          });
          return;
        }
        targetUser = userRes.rows[0];
      }

      // Insert membership
      const memberRes = await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) 
         DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
         RETURNING id, workspace_id, user_id, role, created_at;`,
        [workspaceId, targetUser.id, role]
      );

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'workspace_member_added',
        resourceType: 'workspace_membership',
        resourceId: memberRes.rows[0].id,
        details: { targetUserId: targetUser.id, targetEmail: email, assignedRole: role },
        ipAddress: req.ip,
      });

      res.status(201).json({
        status: 'ok',
        member: {
          ...memberRes.rows[0],
          email: targetUser.email,
          fullName: targetUser.full_name,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 6. Update member role
workspacesRouter.patch(
  '/:workspaceId/members/:userId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const parse = UpdateRoleSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid role update parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { role: newRole } = parse.data;
      const workspaceId = req.workspace!.id;
      const targetUserId = req.params.userId;
      const callerRole = req.membership!.role;
      const callerId = req.user!.id;

      // Sole owner demotion protection: cannot demote the sole owner of the workspace
      if (targetUserId === callerId && callerRole === 'owner' && newRole !== 'owner') {
        const ownerCountRes = await pool.query(
          `SELECT COUNT(*)::int AS count FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner';`,
          [workspaceId]
        );
        if (ownerCountRes.rows[0].count <= 1) {
          res.status(400).json({
            error: 'BadRequest',
            message: 'Cannot demote the sole owner of workspace. Assign another owner first.',
            statusCode: 400,
          });
          return;
        }
      }

      // Self-modification protection: users cannot alter their own role
      if (targetUserId === callerId) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You cannot modify your own role in the workspace.',
          statusCode: 403,
        });
        return;
      }

      // Role escalation protection: cannot promote someone above your own role
      if (!isRoleSufficient(callerRole, newRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Cannot assign role "${newRole}". You can only manage roles up to your current privilege level (${callerRole}).`,
          statusCode: 403,
        });
        return;
      }

      await client.query('BEGIN');

      // Fetch target membership
      const targetRes = await client.query(
        `SELECT id, role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE;`,
        [workspaceId, targetUserId]
      );

      if (targetRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'NotFound', message: 'Member not found in this workspace.', statusCode: 404 });
        return;
      }

      const currentTargetRole = targetRes.rows[0].role as WorkspaceRole;

      // Cannot modify someone with a higher role than self
      if (!isRoleSufficient(callerRole, currentTargetRole) && callerRole !== 'owner') {
        await client.query('ROLLBACK');
        res.status(403).json({
          error: 'Forbidden',
          message: `You cannot modify members with role "${currentTargetRole}".`,
          statusCode: 403,
        });
        return;
      }

      // Last owner protection: if demoting an owner, ensure at least one other owner remains
      if (currentTargetRole === 'owner' && newRole !== 'owner') {
        const ownerCountRes = await client.query(
          `SELECT COUNT(*)::int AS count FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner';`,
          [workspaceId]
        );
        if (ownerCountRes.rows[0].count <= 1) {
          await client.query('ROLLBACK');
          res.status(400).json({
            error: 'BadRequest',
            message: 'Cannot demote the sole owner of the workspace. Promote another member to owner first.',
            statusCode: 400,
          });
          return;
        }
      }

      await client.query(
        `UPDATE workspace_memberships SET role = $1, updated_at = NOW() WHERE workspace_id = $2 AND user_id = $3;`,
        [newRole, workspaceId, targetUserId]
      );

      await client.query('COMMIT');

      await recordAuditEvent({
        workspaceId,
        actorId: callerId,
        action: 'workspace_member_role_updated',
        resourceType: 'workspace_membership',
        resourceId: targetRes.rows[0].id,
        details: { targetUserId, oldRole: currentTargetRole, newRole },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Member role updated successfully',
        member: { userId: targetUserId, role: newRole },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 7. Remove member from workspace
workspacesRouter.delete(
  '/:workspaceId/members/:userId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const targetUserId = req.params.userId;
      const callerRole = req.membership!.role;
      const callerId = req.user!.id;

      await client.query('BEGIN');

      const targetRes = await client.query(
        `SELECT id, role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE;`,
        [workspaceId, targetUserId]
      );

      if (targetRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'NotFound', message: 'Member not found in this workspace.', statusCode: 404 });
        return;
      }

      const targetRole = targetRes.rows[0].role as WorkspaceRole;

      // Last owner protection: cannot remove sole owner
      if (targetRole === 'owner') {
        const ownerCountRes = await client.query(
          `SELECT COUNT(*)::int AS count FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner';`,
          [workspaceId]
        );
        if (ownerCountRes.rows[0].count <= 1) {
          await client.query('ROLLBACK');
          res.status(400).json({
            error: 'BadRequest',
            message: 'Cannot remove the sole owner of the workspace.',
            statusCode: 400,
          });
          return;
        }
      }

      // Non-owners cannot remove owners
      if (targetRole === 'owner' && callerRole !== 'owner') {
        await client.query('ROLLBACK');
        res.status(403).json({
          error: 'Forbidden',
          message: 'Only workspace owners can remove an owner.',
          statusCode: 403,
        });
        return;
      }

      await client.query(
        `DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceId, targetUserId]
      );

      await client.query('COMMIT');

      await recordAuditEvent({
        workspaceId,
        actorId: callerId,
        action: 'workspace_member_removed',
        resourceType: 'workspace_membership',
        resourceId: targetRes.rows[0].id,
        details: { removedUserId: targetUserId, role: targetRole },
        ipAddress: req.ip,
      });

      res.status(200).json({ status: 'ok', message: 'Member removed successfully' });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 8. View Audit Logs (Admin+)
workspacesRouter.get(
  '/:workspaceId/audit-logs',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 100);
      const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

      const query = `
        SELECT 
          id, workspace_id, actor_id, action, resource_type, resource_id,
          details, ip_address, created_at
        FROM audit_events
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3;
      `;

      const result = await pool.query(query, [workspaceId, limit, offset]);
      res.status(200).json({ status: 'ok', auditEvents: result.rows });
    } catch (err) {
      next(err);
    }
  }
);
