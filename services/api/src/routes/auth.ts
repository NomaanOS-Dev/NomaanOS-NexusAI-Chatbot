import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../services/password.js';
import { createSession, revokeSession } from '../services/session.js';
import { setSessionCookie, clearSessionCookie } from '../services/cookie.js';
import { authenticate } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rate-limiter.js';
import { recordAuditEvent } from '../services/audit-service.js';

export const authRouter = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().max(255).optional(),
  organizationName: z.string().min(2).max(255).optional(),
  workspaceName: z.string().min(2).max(255).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${base || 'tenant'}-${suffix}`;
}

// 1. User Registration
authRouter.post('/register', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parse = RegisterSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid registration parameters',
        statusCode: 400,
        details: parse.error.issues,
      });
      return;
    }

    const { email, password, fullName, organizationName, workspaceName } = parse.data;

    // Password strength check
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      res.status(400).json({
        error: 'ValidationError',
        message: strength.error || 'Password does not satisfy complexity requirements',
        statusCode: 400,
      });
      return;
    }

    await client.query('BEGIN');

    // Check if user already exists
    const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'Conflict',
        message: 'A user with this email address is already registered',
        statusCode: 409,
      });
      return;
    }

    // 1. Create User
    const passwordHash = await hashPassword(password);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, is_verified, is_active)
       VALUES ($1, $2, $3, TRUE, TRUE)
       RETURNING id, email, full_name, is_verified, is_active, created_at;`,
      [email.toLowerCase(), passwordHash, fullName || null]
    );
    const user = userRes.rows[0];

    // 2. Create Default Organization
    const orgName = organizationName || `${fullName || email.split('@')[0]}'s Organization`;
    const orgSlug = slugify(orgName);
    const orgRes = await client.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id, name, slug, created_at;`,
      [orgName, orgSlug]
    );
    const organization = orgRes.rows[0];

    // 3. Create Default Workspace
    const wsName = workspaceName || 'Default Workspace';
    const wsSlug = slugify(wsName);
    const wsRes = await client.query(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING id, organization_id, name, slug, created_at;`,
      [organization.id, wsName, wsSlug]
    );
    const workspace = wsRes.rows[0];

    // 4. Assign Owner Membership
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [workspace.id, user.id]
    );

    // 5. Create Session
    const { sessionToken, expiresAt } = await createSession(user.id, req, client);

    await client.query('COMMIT');

    // Audit Event
    await recordAuditEvent({
      workspaceId: workspace.id,
      actorId: user.id,
      action: 'user_registered',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    setSessionCookie(res, sessionToken, expiresAt);

    res.status(201).json({
      status: 'ok',
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isVerified: user.is_verified,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
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

// 2. User Login
authRouter.post('/login', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parse = LoginSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Email and password are required',
        statusCode: 400,
      });
      return;
    }

    const { email, password } = parse.data;

    const userRes = await pool.query(
      `SELECT id, email, password_hash, full_name, is_verified, is_active
       FROM users
       WHERE LOWER(email) = LOWER($1);`,
      [email]
    );

    if (userRes.rows.length === 0) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
        statusCode: 401,
      });
      return;
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'This account has been deactivated',
        statusCode: 403,
      });
      return;
    }

    const matches = await verifyPassword(password, user.password_hash);
    if (!matches) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
        statusCode: 401,
      });
      return;
    }

    // Create session & issue cookie
    const { sessionToken, expiresAt } = await createSession(user.id, req);
    setSessionCookie(res, sessionToken, expiresAt);

    // Fetch user's workspaces
    const wsRes = await pool.query(
      `SELECT w.id, w.name, w.slug, w.organization_id, wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY wm.created_at ASC;`,
      [user.id]
    );

    // Record login audit
    if (wsRes.rows.length > 0) {
      await recordAuditEvent({
        workspaceId: wsRes.rows[0].id,
        actorId: user.id,
        action: 'user_logged_in',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: req.ip,
      });
    }

    res.status(200).json({
      status: 'ok',
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isVerified: user.is_verified,
      },
      workspaces: wsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// 3. User Logout
authRouter.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.sessionToken) {
      await revokeSession(req.sessionToken);
    }
    clearSessionCookie(res);

    res.status(200).json({
      status: 'ok',
      message: 'Logged out successfully',
    });
  } catch (err) {
    next(err);
  }
});

// 4. Get Current Profile
authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    const wsRes = await pool.query(
      `SELECT w.id, w.name, w.slug, w.organization_id, wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY wm.created_at ASC;`,
      [user.id]
    );

    res.status(200).json({
      status: 'ok',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isVerified: user.is_verified,
      },
      workspaces: wsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});
