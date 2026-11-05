import { Request } from 'express';
import pg from 'pg';
import { pool } from '../database/pool.js';
import { generateSecureToken, hashToken } from './tokens.js';
import { config } from '../config/env.js';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  fullName: string | null;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AuthSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_active_at: string;
}

export async function createSession(
  userId: string,
  req?: Request,
  dbExecutor: pg.Pool | pg.PoolClient = pool
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const { rawToken, tokenHash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + config.auth.sessionExpirationDays * 24 * 60 * 60 * 1000);

  const userAgent = req?.headers['user-agent']?.slice(0, 512) || null;
  const ipAddress =
    (req?.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null;

  const query = `
    INSERT INTO sessions (
      session_token_hash, user_id, expires_at, user_agent, ip_address
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
  `;

  await dbExecutor.query(query, [tokenHash, userId, expiresAt.toISOString(), userAgent, ipAddress]);

  return { sessionToken: rawToken, expiresAt };
}

export async function validateSession(
  sessionToken: string
): Promise<{ user: AuthUser; session: AuthSession } | null> {
  if (!sessionToken || typeof sessionToken !== 'string') {
    return null;
  }

  const tokenHash = hashToken(sessionToken);

  const query = `
    SELECT 
      u.id AS user_id,
      u.email,
      u.full_name,
      u.is_verified,
      u.is_active,
      u.created_at AS user_created_at,
      s.id AS session_id,
      s.expires_at,
      s.created_at AS session_created_at,
      s.last_active_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_token_hash = $1
      AND s.expires_at > NOW()
      AND u.is_active = TRUE;
  `;

  const res = await pool.query(query, [tokenHash]);
  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];

  // Refresh last_active_at in the background (fire-and-forget throttle: only if > 5 minutes old)
  const lastActive = new Date(row.last_active_at).getTime();
  if (Date.now() - lastActive > 5 * 60 * 1000) {
    pool
      .query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [row.session_id])
      .catch(() => {});
  }

  return {
    user: {
      id: row.user_id,
      email: row.email,
      full_name: row.full_name,
      fullName: row.full_name,
      is_verified: row.is_verified,
      is_active: row.is_active,
      created_at: new Date(row.user_created_at).toISOString(),
    },
    session: {
      id: row.session_id,
      user_id: row.user_id,
      expires_at: new Date(row.expires_at).toISOString(),
      created_at: new Date(row.session_created_at).toISOString(),
      last_active_at: new Date(row.last_active_at).toISOString(),
    },
  };
}

export async function revokeSession(sessionToken: string): Promise<boolean> {
  if (!sessionToken) return false;
  const tokenHash = hashToken(sessionToken);
  const res = await pool.query('DELETE FROM sessions WHERE session_token_hash = $1', [tokenHash]);
  return (res.rowCount ?? 0) > 0;
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

