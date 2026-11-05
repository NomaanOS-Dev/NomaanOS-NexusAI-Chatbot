import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import {
  authenticate,
  requireWorkspaceAdmin,
} from '../middleware/auth.js';
import { encryptSecret, maskApiKey } from '../services/tokens.js';
import { recordAuditEvent } from '../services/audit-service.js';

export const credentialsRouter = Router({ mergeParams: true });

const SaveCredentialSchema = z.object({
  provider: z.enum(['openai', 'gemini', 'anthropic', 'ollama', 'custom']),
  keyName: z.string().min(2).max(128),
  apiKey: z.string().min(6).max(512),
});

// 1. Save or Update Provider Credential (Admin+ only)
credentialsRouter.post(
  '/',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = SaveCredentialSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid credential payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const { provider, keyName, apiKey } = parse.data;

      // Encrypt API key with AES-256-GCM
      const encryptedKey = encryptSecret(apiKey);
      const fingerprint = maskApiKey(apiKey);

      const result = await pool.query(
        `INSERT INTO provider_credentials (
           workspace_id, provider, key_name, encrypted_api_key, key_fingerprint, status, created_by
         ) VALUES ($1, $2, $3, $4, $5, 'active', $6)
         ON CONFLICT (workspace_id, provider) DO UPDATE SET
           key_name = EXCLUDED.key_name,
           encrypted_api_key = EXCLUDED.encrypted_api_key,
           key_fingerprint = EXCLUDED.key_fingerprint,
           status = 'active',
           updated_at = NOW()
         RETURNING id, workspace_id, provider, key_name, key_fingerprint, status, created_at, updated_at;`,
        [workspaceId, provider, keyName, encryptedKey, fingerprint, req.user!.id]
      );

      const credential = result.rows[0];

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'provider_credential_saved',
        resourceType: 'provider_credential',
        resourceId: credential.id,
        details: {
          provider,
          keyName,
          keyFingerprint: fingerprint,
        },
        ipAddress: req.ip,
      });

      // Strict security: NEVER return encrypted_api_key or plaintext apiKey
      res.status(201).json({
        status: 'ok',
        credential: {
          id: credential.id,
          workspaceId: credential.workspace_id,
          provider: credential.provider,
          keyName: credential.key_name,
          keyFingerprint: credential.key_fingerprint,
          status: credential.status,
          createdAt: credential.created_at,
          updatedAt: credential.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. List Provider Credentials (Admin+ only, Masked)
credentialsRouter.get(
  '/',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;

      // Query only metadata and masked fingerprint; omit encrypted_api_key
      const result = await pool.query(
        `SELECT id, workspace_id, provider, key_name, key_fingerprint, status, created_at, updated_at
         FROM provider_credentials
         WHERE workspace_id = $1
         ORDER BY created_at DESC;`,
        [workspaceId]
      );

      const credentials = result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        provider: row.provider,
        keyName: row.key_name,
        keyFingerprint: row.key_fingerprint,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      res.status(200).json({
        status: 'ok',
        credentials,
        total: credentials.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Get Single Credential Metadata (Admin+ only, Masked)
credentialsRouter.get(
  '/:credentialId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const credentialId = req.params.credentialId;

      const result = await pool.query(
        `SELECT id, workspace_id, provider, key_name, key_fingerprint, status, created_at, updated_at
         FROM provider_credentials
         WHERE id = $1 AND workspace_id = $2;`,
        [credentialId, workspaceId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Credential not found.',
          statusCode: 404,
        });
        return;
      }

      const row = result.rows[0];

      res.status(200).json({
        status: 'ok',
        credential: {
          id: row.id,
          workspaceId: row.workspace_id,
          provider: row.provider,
          keyName: row.key_name,
          keyFingerprint: row.key_fingerprint,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Delete / Revoke Credential (Admin+ only)
credentialsRouter.delete(
  '/:credentialId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const credentialId = req.params.credentialId;

      const deleteRes = await pool.query(
        `DELETE FROM provider_credentials WHERE id = $1 AND workspace_id = $2 RETURNING id, provider, key_name;`,
        [credentialId, workspaceId]
      );

      if (deleteRes.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Credential not found.',
          statusCode: 404,
        });
        return;
      }

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'provider_credential_deleted',
        resourceType: 'provider_credential',
        resourceId: credentialId,
        details: {
          provider: deleteRes.rows[0].provider,
          keyName: deleteRes.rows[0].key_name,
        },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Provider credential deleted successfully.',
      });
    } catch (err) {
      next(err);
    }
  }
);

