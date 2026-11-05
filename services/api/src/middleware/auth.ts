import { Request, Response, NextFunction } from 'express';
import { validateSession, AuthUser, AuthSession } from '../services/session.js';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { recordAuditEvent } from '../services/audit-service.js';

export type WorkspaceRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  analyst: 2,
  viewer: 1,
};

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  organization_id: string;
  status: string;
}

export interface MembershipContext {
  id: string;
  role: WorkspaceRole;
  created_at: string;
}

// Augment Express Request declaration
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      session?: AuthSession;
      sessionToken?: string;
      workspace?: WorkspaceContext;
      membership?: MembershipContext;
    }
  }
}

export function isRoleSufficient(userRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates session token from HttpOnly cookie or Authorization Bearer header.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookieName = config.auth.sessionCookieName;
  let sessionToken: string | undefined = req.cookies?.[cookieName];

  if (!sessionToken && req.headers.authorization?.startsWith('Bearer ')) {
    sessionToken = req.headers.authorization.slice(7).trim();
  }

  if (!sessionToken) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please sign in.',
      statusCode: 401,
    });
    return;
  }

  try {
    const authData = await validateSession(sessionToken);
    if (!authData) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired session. Please sign in again.',
        statusCode: 401,
      });
      return;
    }

    req.user = authData.user;
    req.session = authData.session;
    req.sessionToken = sessionToken;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional authentication: attaches user context if valid session token provided, but does not block.
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const cookieName = config.auth.sessionCookieName;
  let sessionToken: string | undefined = req.cookies?.[cookieName];

  if (!sessionToken && req.headers.authorization?.startsWith('Bearer ')) {
    sessionToken = req.headers.authorization.slice(7).trim();
  }

  if (!sessionToken) {
    return next();
  }

  try {
    const authData = await validateSession(sessionToken);
    if (authData) {
      req.user = authData.user;
      req.session = authData.session;
      req.sessionToken = sessionToken;
    }
    next();
  } catch {
    // Proceed without authenticated user on error
    next();
  }
}

/**
 * Enforces that the authenticated user has active membership in the target workspace
 * and that their role meets or exceeds the required role.
 */
export function requireWorkspaceMember(requiredRole: WorkspaceRole = 'viewer') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required.',
        statusCode: 401,
      });
      return;
    }

    const workspaceId = (req.params.workspaceId || req.headers['x-workspace-id']) as string | undefined;

    if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
      res.status(400).json({
        error: 'BadRequest',
        message: 'A valid workspace UUID is required in request parameters or x-workspace-id header.',
        statusCode: 400,
      });
      return;
    }

    try {
      const query = `
        SELECT 
          w.id AS workspace_id,
          w.name AS workspace_name,
          w.slug AS workspace_slug,
          w.organization_id,
          w.status AS workspace_status,
          wm.id AS membership_id,
          wm.role AS workspace_role,
          wm.created_at AS membership_created_at
        FROM workspaces w
        LEFT JOIN workspace_memberships wm 
          ON w.id = wm.workspace_id AND wm.user_id = $2
        WHERE w.id = $1;
      `;

      const result = await pool.query(query, [workspaceId, req.user.id]);

      if (result.rows.length === 0) {
        // Workspace does not exist
        res.status(404).json({
          error: 'NotFound',
          message: 'Workspace not found.',
          statusCode: 404,
        });
        return;
      }

      const row = result.rows[0];

      // Anti-enumeration: if user is not a member of this workspace, return 404 Not Found
      if (!row.membership_id) {
        // Record cross-tenant access attempt in audit log
        await recordAuditEvent({
          workspaceId,
          actorId: req.user.id,
          action: 'unauthorized_cross_tenant_access_denied',
          resourceType: 'workspace',
          resourceId: workspaceId,
          details: { requestedRole: requiredRole },
          ipAddress: req.ip,
        });

        res.status(404).json({
          error: 'NotFound',
          message: 'Workspace not found.',
          statusCode: 404,
        });
        return;
      }

      const userRole = row.workspace_role as WorkspaceRole;

      if (!isRoleSufficient(userRole, requiredRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `This action requires ${requiredRole} privileges. Current role: ${userRole}.`,
          statusCode: 403,
        });
        return;
      }

      req.workspace = {
        id: row.workspace_id,
        name: row.workspace_name,
        slug: row.workspace_slug,
        organization_id: row.organization_id,
        status: row.workspace_status,
      };

      req.membership = {
        id: row.membership_id,
        role: userRole,
        created_at: new Date(row.membership_created_at).toISOString(),
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireWorkspaceOwner = requireWorkspaceMember('owner');
export const requireWorkspaceAdmin = requireWorkspaceMember('admin');
export const requireWorkspaceAnalyst = requireWorkspaceMember('analyst');
export const requireWorkspaceViewer = requireWorkspaceMember('viewer');

