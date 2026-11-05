import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { redactSensitiveString } from '../config/logger.js';

export interface AuditEventParams {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | string[] | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Recursively redacts any sensitive keys from audit event details objects.
 */
function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details) return {};

  const clean: Record<string, unknown> = {};
  const SENSITIVE_KEYS = new Set([
    'password',
    'passwordhash',
    'token',
    'sessiontoken',
    'secret',
    'apikey',
    'rawapikey',
    'encryptedapikey',
    'authorization',
  ]);

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      clean[key] = redactSensitiveString(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      clean[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Persists an immutable security audit event to the database and structured logger.
 */
export async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    const sanitizedDetails = sanitizeAuditDetails(params.details);
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const rawResourceId = Array.isArray(params.resourceId) ? params.resourceId[0] : params.resourceId;
    const resourceIdUuid = typeof rawResourceId === 'string' && UUID_REGEX.test(rawResourceId)
      ? rawResourceId
      : null;

    const query = `
      INSERT INTO audit_events (
        workspace_id, actor_id, action, resource_type, resource_id, details, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at;
    `;

    await pool.query(query, [
      params.workspaceId,
      params.actorId || null,
      params.action,
      params.resourceType,
      resourceIdUuid,
      JSON.stringify(sanitizedDetails),
      params.ipAddress || null,
    ]);

    logger.info(
      {
        audit: {
          workspaceId: params.workspaceId,
          actorId: params.actorId,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
        },
      },
      `Security Audit Event: ${params.action}`
    );
  } catch (err: any) {
    // Log failure without crashing caller
    logger.error({ error: err.message, action: params.action }, 'Failed to persist security audit event');
  }
}
