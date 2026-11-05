import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: config.database.maxConnections,
  idleTimeoutMillis: config.database.idleTimeoutMs,
  connectionTimeoutMillis: config.database.connectionTimeoutMs,
});

pool.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected idle client error on Nexus AI database pool');
});

/**
 * Validates active connectivity to PostgreSQL within a bounded timeout.
 * Redacts any embedded credentials in network or authentication errors.
 */
export async function checkDatabaseConnection(
  timeoutMs = 2500
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database connection timed out')), timeoutMs)
      ),
    ]);

    try {
      await client.query('SELECT 1');
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } finally {
      client.release();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown database error';
    const sanitizedError = errorMsg.replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[REDACTED]@');
    return { ok: false, error: sanitizedError };
  }
}

/**
 * Validates that the pgvector extension is installed and available in the database.
 */
export async function checkPgVectorAvailable(
  timeoutMs = 2500
): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('pgvector check connection timed out')), timeoutMs)
      ),
    ]);

    try {
      const res = await client.query(
        "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
      );
      if (res.rows.length === 0) {
        return { ok: false, error: 'Extension "vector" is not installed in the database.' };
      }
      return { ok: true, version: res.rows[0].extversion };
    } finally {
      client.release();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown vector check error';
    const sanitizedError = errorMsg.replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[REDACTED]@');
    return { ok: false, error: sanitizedError };
  }
}

