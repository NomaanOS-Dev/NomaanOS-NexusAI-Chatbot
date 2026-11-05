import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import {
  authenticate,
  optionalAuthenticate,
  requireWorkspaceMember,
  requireWorkspaceAdmin,
  requireWorkspaceAnalyst,
  requireWorkspaceViewer,
} from '../middleware/auth.js';
import { recordAuditEvent } from '../services/audit-service.js';

export const assistantsRouter = Router({ mergeParams: true });
export const publicAssistantsRouter = Router();

const CreateAssistantSchema = z.object({
  name: z.string().min(2).max(255),
  assistantKey: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z0-9_\-]+$/i, {
      message: 'Assistant key must contain alphanumeric, underscore, or hyphen characters',
    }),
  description: z.string().max(1000).optional().nullable(),
  systemPrompt: z.string().min(10).max(20000),
  modelPolicy: z.enum(['local-only', 'cloud-preferred', 'hybrid', 'cloud-only']).default('cloud-preferred'),
  temperature: z.number().min(0.0).max(2.0).default(0.2),
  publicEmbedAllowed: z.boolean().default(false),
  avatarUrl: z.string().url().optional().nullable(),
  theme: z.record(z.unknown()).optional().default({}),
  greetingMessage: z.string().max(500).optional().nullable(),
  suggestedPrompts: z.array(z.string().max(200)).max(10).optional().default([]),
  applicationId: z.string().uuid().optional().nullable(),
});

const UpdateAssistantSchema = CreateAssistantSchema.partial();

// 1. Create Assistant (Analyst+)
assistantsRouter.post(
  '/',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = CreateAssistantSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid assistant parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const data = parse.data;

      // Invariant: If applicationId is provided, verify it belongs strictly to THIS workspace
      if (data.applicationId) {
        const appRes = await pool.query(
          `SELECT id FROM applications WHERE id = $1 AND workspace_id = $2;`,
          [data.applicationId, workspaceId]
        );
        if (appRes.rows.length === 0) {
          res.status(400).json({
            error: 'BadRequest',
            message: 'Application does not exist in this workspace. Cross-tenant application association is forbidden.',
            statusCode: 400,
          });
          return;
        }
      }

      // Check unique assistant_key in workspace
      const keyCheck = await pool.query(
        `SELECT id FROM assistants WHERE workspace_id = $1 AND assistant_key = $2;`,
        [workspaceId, data.assistantKey]
      );
      if (keyCheck.rows.length > 0) {
        res.status(409).json({
          error: 'Conflict',
          message: `Assistant with key "${data.assistantKey}" already exists in this workspace.`,
          statusCode: 409,
        });
        return;
      }

      const insertRes = await pool.query(
        `INSERT INTO assistants (
          workspace_id, application_id, name, assistant_key, description,
          system_prompt, model_policy, temperature, public_embed_allowed,
          avatar_url, theme, greeting_message, suggested_prompts
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, workspace_id, application_id, name, assistant_key, description,
                  model_policy, temperature, status, public_embed_allowed, avatar_url,
                  theme, greeting_message, suggested_prompts, created_at, updated_at;`,
        [
          workspaceId,
          data.applicationId || null,
          data.name,
          data.assistantKey,
          data.description || null,
          data.systemPrompt,
          data.modelPolicy,
          data.temperature,
          data.publicEmbedAllowed,
          data.avatarUrl || null,
          JSON.stringify(data.theme),
          data.greetingMessage || null,
          JSON.stringify(data.suggestedPrompts),
        ]
      );

      const assistant = insertRes.rows[0];

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_created',
        resourceType: 'assistant',
        resourceId: assistant.id,
        details: { name: assistant.name, assistantKey: assistant.assistant_key },
        ipAddress: req.ip,
      });

      res.status(201).json({ status: 'created', assistant });
    } catch (err) {
      next(err);
    }
  }
);

// 2. List Assistants (Viewer+)
assistantsRouter.get(
  '/',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const query = `
        SELECT 
          id, workspace_id, application_id, name, assistant_key, description,
          model_policy, temperature, status, public_embed_allowed, avatar_url,
          theme, greeting_message, suggested_prompts, created_at, updated_at
        FROM assistants
        WHERE workspace_id = $1
        ORDER BY created_at DESC;
      `;
      const result = await pool.query(query, [workspaceId]);
      res.status(200).json({ status: 'ok', assistants: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Get Assistant Details (Viewer+, Tenant-Scoped)
assistantsRouter.get(
  '/:assistantId',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const assistantId = req.params.assistantId;

      const query = `
        SELECT 
          id, workspace_id, application_id, name, assistant_key, description,
          system_prompt, model_policy, temperature, status, public_embed_allowed,
          avatar_url, theme, greeting_message, suggested_prompts, created_at, updated_at
        FROM assistants
        WHERE id = $1 AND workspace_id = $2;
      `;
      const result = await pool.query(query, [assistantId, workspaceId]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Assistant not found.', statusCode: 404 });
        return;
      }

      res.status(200).json({ status: 'ok', assistant: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Update Assistant (Analyst+, Tenant-Scoped)
assistantsRouter.patch(
  '/:assistantId',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = UpdateAssistantSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid update parameters',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const workspaceId = req.workspace!.id;
      const assistantId = req.params.assistantId;
      const data = parse.data;

      // Verify assistant exists in this workspace
      const existingRes = await pool.query(
        `SELECT id FROM assistants WHERE id = $1 AND workspace_id = $2;`,
        [assistantId, workspaceId]
      );
      if (existingRes.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Assistant not found.', statusCode: 404 });
        return;
      }

      // Invariant: If applicationId updated, verify it belongs strictly to this workspace
      if (data.applicationId) {
        const appRes = await pool.query(
          `SELECT id FROM applications WHERE id = $1 AND workspace_id = $2;`,
          [data.applicationId, workspaceId]
        );
        if (appRes.rows.length === 0) {
          res.status(400).json({
            error: 'BadRequest',
            message: 'Application does not exist in this workspace. Cross-tenant application association is forbidden.',
            statusCode: 400,
          });
          return;
        }
      }

      const updateFields: string[] = [];
      const values: any[] = [assistantId, workspaceId];

      const fieldMap: Record<string, string> = {
        name: 'name',
        description: 'description',
        systemPrompt: 'system_prompt',
        modelPolicy: 'model_policy',
        temperature: 'temperature',
        publicEmbedAllowed: 'public_embed_allowed',
        avatarUrl: 'avatar_url',
        greetingMessage: 'greeting_message',
        applicationId: 'application_id',
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if ((data as any)[key] !== undefined) {
          values.push((data as any)[key]);
          updateFields.push(`${col} = $${values.length}`);
        }
      }

      if (data.theme !== undefined) {
        values.push(JSON.stringify(data.theme));
        updateFields.push(`theme = $${values.length}`);
      }
      if (data.suggestedPrompts !== undefined) {
        values.push(JSON.stringify(data.suggestedPrompts));
        updateFields.push(`suggested_prompts = $${values.length}`);
      }

      if (updateFields.length === 0) {
        res.status(400).json({ error: 'BadRequest', message: 'No update fields provided.', statusCode: 400 });
        return;
      }

      updateFields.push('updated_at = NOW()');

      const query = `
        UPDATE assistants
        SET ${updateFields.join(', ')}
        WHERE id = $1 AND workspace_id = $2
        RETURNING id, workspace_id, application_id, name, assistant_key, description,
                  model_policy, temperature, status, public_embed_allowed, avatar_url,
                  theme, greeting_message, suggested_prompts, created_at, updated_at;
      `;

      const result = await pool.query(query, values);

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_updated',
        resourceType: 'assistant',
        resourceId: assistantId,
        details: { updatedFields: Object.keys(data) },
        ipAddress: req.ip,
      });

      res.status(200).json({ status: 'ok', assistant: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Delete Assistant (Admin+, Tenant-Scoped)
assistantsRouter.delete(
  '/:assistantId',
  authenticate,
  requireWorkspaceAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const assistantId = req.params.assistantId;

      const deleteRes = await pool.query(
        `DELETE FROM assistants WHERE id = $1 AND workspace_id = $2 RETURNING id, name;`,
        [assistantId, workspaceId]
      );

      if (deleteRes.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Assistant not found.', statusCode: 404 });
        return;
      }

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_deleted',
        resourceType: 'assistant',
        resourceId: assistantId,
        details: { name: deleteRes.rows[0].name },
        ipAddress: req.ip,
      });

      res.status(200).json({ status: 'ok', message: 'Assistant deleted successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

// 6. Link Knowledge Space to Assistant (Analyst+, Tenant-Scoped)
assistantsRouter.post(
  '/:assistantId/knowledge-spaces/:knowledgeSpaceId',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { assistantId, knowledgeSpaceId } = req.params;

      // 1. Verify assistant belongs to current workspace
      const assistantCheck = await pool.query(
        `SELECT id, name FROM assistants WHERE id = $1 AND workspace_id = $2;`,
        [assistantId, workspaceId]
      );
      if (assistantCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Assistant not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      // 2. Verify knowledge space belongs to current workspace
      const spaceCheck = await pool.query(
        `SELECT id, name FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
        [knowledgeSpaceId, workspaceId]
      );
      if (spaceCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Knowledge space not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      await pool.query(
        `INSERT INTO assistant_knowledge_spaces (assistant_id, knowledge_space_id)
         VALUES ($1, $2)
         ON CONFLICT (assistant_id, knowledge_space_id) DO NOTHING;`,
        [assistantId, knowledgeSpaceId]
      );

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_knowledge_space_linked',
        resourceType: 'assistant_knowledge_space',
        resourceId: `${assistantId}:${knowledgeSpaceId}`,
        details: {
          assistantId,
          knowledgeSpaceId,
          assistantName: assistantCheck.rows[0].name,
          spaceName: spaceCheck.rows[0].name,
        },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Knowledge space successfully linked to assistant.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// 7. Unlink Knowledge Space from Assistant (Analyst+, Tenant-Scoped)
assistantsRouter.delete(
  '/:assistantId/knowledge-spaces/:knowledgeSpaceId',
  authenticate,
  requireWorkspaceAnalyst,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { assistantId, knowledgeSpaceId } = req.params;

      const assistantCheck = await pool.query(
        `SELECT id FROM assistants WHERE id = $1 AND workspace_id = $2;`,
        [assistantId, workspaceId]
      );
      const spaceCheck = await pool.query(
        `SELECT id FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
        [knowledgeSpaceId, workspaceId]
      );

      if (assistantCheck.rows.length === 0 || spaceCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Assistant or knowledge space not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      await pool.query(
        `DELETE FROM assistant_knowledge_spaces WHERE assistant_id = $1 AND knowledge_space_id = $2;`,
        [assistantId, knowledgeSpaceId]
      );

      await recordAuditEvent({
        workspaceId,
        actorId: req.user!.id,
        action: 'assistant_knowledge_space_unlinked',
        resourceType: 'assistant_knowledge_space',
        resourceId: `${assistantId}:${knowledgeSpaceId}`,
        details: { assistantId, knowledgeSpaceId },
        ipAddress: req.ip,
      });

      res.status(200).json({
        status: 'ok',
        message: 'Knowledge space unlinked from assistant.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// 8. List Knowledge Spaces for Assistant (Viewer+)
assistantsRouter.get(
  '/:assistantId/knowledge-spaces',
  authenticate,
  requireWorkspaceViewer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const assistantId = req.params.assistantId;

      const assistantCheck = await pool.query(
        `SELECT id FROM assistants WHERE id = $1 AND workspace_id = $2;`,
        [assistantId, workspaceId]
      );
      if (assistantCheck.rows.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'Assistant not found in this workspace.',
          statusCode: 404,
        });
        return;
      }

      const result = await pool.query(
        `SELECT ks.id, ks.workspace_id, ks.name, ks.slug, ks.description, ks.status, aks.created_at as linked_at
         FROM assistant_knowledge_spaces aks
         JOIN knowledge_spaces ks ON aks.knowledge_space_id = ks.id
         WHERE aks.assistant_id = $1 AND ks.workspace_id = $2
         ORDER BY aks.created_at ASC;`,
        [assistantId, workspaceId]
      );

      res.status(200).json({
        status: 'ok',
        knowledgeSpaces: result.rows,
        total: result.rows.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 9. Public Assistant Configuration Endpoint (Widget-Safe)
// GET /api/v1/assistants/:assistantId/config
publicAssistantsRouter.get('/:assistantId/config', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assistantId = req.params.assistantId;

    const query = `
      SELECT 
        a.id, a.workspace_id, a.name, a.description, a.avatar_url,
        a.theme, a.greeting_message, a.suggested_prompts, a.public_embed_allowed,
        wm.role AS caller_role
      FROM assistants a
      LEFT JOIN workspace_memberships wm 
        ON a.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE a.id = $1 AND a.status = 'active';
    `;

    const result = await pool.query(query, [assistantId, req.user?.id || null]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'NotFound', message: 'Assistant not found.', statusCode: 404 });
      return;
    }

    const row = result.rows[0];

    // If private assistant, caller MUST be an authenticated member of the owning workspace
    if (!row.public_embed_allowed && !row.caller_role) {
      res.status(404).json({
        error: 'NotFound',
        message: 'Assistant not found.',
        statusCode: 404,
      });
      return;
    }

    // NEVER return system_prompt or database credentials
    res.status(200).json({
      assistantId: row.id,
      name: row.name,
      description: row.description,
      avatarUrl: row.avatar_url,
      theme: row.theme || {},
      greetingMessage: row.greeting_message || 'Hello! How can I assist you today?',
      suggestedPrompts: row.suggested_prompts || [],
      capabilities: {
        streaming: true,
        fileUpload: false,
        feedback: true,
        citations: true,
      },
    });
  } catch (err) {
    next(err);
  }
});
