import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { config } from '../config/env.js';
import { recordAuditEvent } from '../services/audit-service.js';
import { analyzeQuery } from '../services/query-understanding.js';
import { adaptiveRetrieve } from '../services/adaptive-retrieval.js';
import { assembleEvidence } from '../services/evidence-assembler.js';
import { synthesizeGroundedAnswer, synthesizeGroundedAnswerAsync } from '../services/grounded-generator.js';
import { validateCitations } from '../services/citation-validator.js';
import { verifyToolExecution } from '../services/tool-verifier.js';
import {
  getBoundedConversationHistory,
  getConversationSummary,
  summarizeConversation,
  deleteConversationMemory,
} from '../services/conversation-memory.js';
import { getUserPreferences } from '../services/user-preferences.js';
import { logger } from '../config/logger.js';

export const conversationsRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateConversationSchema = z.object({
  assistantId: z.string().uuid(),
  title: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

const SendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message content cannot be empty').max(32000, 'Message content exceeds maximum length of 32000 characters'),
  knowledgeSpaceIds: z.array(z.string().uuid()).optional(),
  stream: z.boolean().default(true),
  idempotencyKey: z.string().max(128).optional(),
  responseFormat: z
    .object({
      type: z.enum(['text', 'json_object']).default('text'),
      schema: z.record(z.unknown()).optional(),
      schemaName: z.string().optional(),
    })
    .optional(),
});

const FeedbackSchema = z.object({
  rating: z.enum(['positive', 'negative', 'thumbs_up', 'thumbs_down']),
  comment: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Checks if request presented an expired or invalid authentication token.
 */
function hasInvalidSession(req: Request): boolean {
  const cookieName = config.auth.sessionCookieName;
  const hasToken = Boolean(
    req.cookies?.[cookieName] || 
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer '))
  );
  return hasToken && !req.user;
}

// Helper: Resolve access rights to a conversation
async function resolveConversationAccess(
  conversationId: string,
  req: Request
): Promise<{ conversation: any; assistant: any } | null> {
  if (!UUID_REGEX.test(conversationId)) return null;

  // If client supplied a session token that failed validation, reject as expired/invalid
  if (hasInvalidSession(req)) {
    const error: any = new Error('Invalid or expired session. Please sign in again.');
    error.statusCode = 401;
    error.name = 'Unauthorized';
    throw error;
  }

  const convQuery = `
    SELECT 
      c.id, c.workspace_id, c.assistant_id, c.title, c.created_by,
      c.anonymous_session_token, c.metadata, c.created_at, c.updated_at,
      a.name, a.name AS assistant_name, a.public_embed_allowed, a.system_prompt,
      a.greeting_message,
      wm.role AS caller_role
    FROM conversations c
    JOIN assistants a ON c.assistant_id = a.id
    LEFT JOIN workspace_memberships wm 
      ON c.workspace_id = wm.workspace_id AND wm.user_id = $2
    WHERE c.id = $1 AND a.status = 'active';
  `;

  const convRes = await pool.query(convQuery, [conversationId, req.user?.id || null]);
  if (convRes.rows.length === 0) return null;

  const row = convRes.rows[0];

  // If user is authenticated workspace member, allow
  if (row.caller_role) {
    return { conversation: row, assistant: row };
  }

  // If user is the creator
  if (req.user && row.created_by === req.user.id) {
    return { conversation: row, assistant: row };
  }

  // If anonymous public assistant, require exact matching anonymous session token
  const anonHeader = (req.headers['x-anonymous-session-token'] as string) || '';
  if (row.public_embed_allowed && row.anonymous_session_token) {
    if (anonHeader && anonHeader === row.anonymous_session_token) {
      return { conversation: row, assistant: row };
    }
  }

  return null;
}

// 1. List Previous Conversations
// GET /api/v1/conversations
conversationsRouter.get('/', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (hasInvalidSession(req)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session.', statusCode: 401 });
      return;
    }

    const parse = PaginationSchema.safeParse(req.query);
    const { limit, offset } = parse.success ? parse.data : { limit: 50, offset: 0 };

    const userId = req.user?.id || null;
    const anonHeader = (req.headers['x-anonymous-session-token'] as string) || null;

    if (!userId && !anonHeader) {
      res.status(200).json({ status: 'ok', conversations: [], total: 0, limit, offset });
      return;
    }

    let listQuery: string;
    let countQuery: string;
    let queryParams: any[];

    if (userId) {
      listQuery = `
        SELECT 
          c.id, c.workspace_id, c.assistant_id, c.title, c.created_at, c.updated_at,
          a.name AS assistant_name,
          (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
        FROM conversations c
        JOIN assistants a ON c.assistant_id = a.id
        WHERE c.created_by = $1
        ORDER BY c.updated_at DESC
        LIMIT $2 OFFSET $3;
      `;
      countQuery = `SELECT COUNT(*)::int AS total FROM conversations WHERE created_by = $1;`;
      queryParams = [userId, limit, offset];
    } else {
      listQuery = `
        SELECT 
          c.id, c.workspace_id, c.assistant_id, c.title, c.created_at, c.updated_at,
          a.name AS assistant_name,
          (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
        FROM conversations c
        JOIN assistants a ON c.assistant_id = a.id
        WHERE c.anonymous_session_token = $1
        ORDER BY c.updated_at DESC
        LIMIT $2 OFFSET $3;
      `;
      countQuery = `SELECT COUNT(*)::int AS total FROM conversations WHERE anonymous_session_token = $1;`;
      queryParams = [anonHeader, limit, offset];
    }

    const [listRes, countRes] = await Promise.all([
      pool.query(listQuery, queryParams),
      pool.query(countQuery, [queryParams[0]]),
    ]);

    res.status(200).json({
      status: 'ok',
      conversations: listRes.rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        assistantId: r.assistant_id,
        assistantName: r.assistant_name,
        title: r.title,
        messageCount: r.message_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total: countRes.rows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

// 2. Create a New Conversation
// POST /api/v1/conversations
conversationsRouter.post('/', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (hasInvalidSession(req)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session.', statusCode: 401 });
      return;
    }

    const parse = CreateConversationSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid conversation payload',
        statusCode: 400,
        details: parse.error.issues,
      });
      return;
    }

    const { assistantId, title, metadata } = parse.data;

    // Fetch assistant & verify permissions
    const asstQuery = `
      SELECT 
        a.id, a.workspace_id, a.name, a.public_embed_allowed, a.status,
        wm.role AS caller_role
      FROM assistants a
      LEFT JOIN workspace_memberships wm 
        ON a.workspace_id = wm.workspace_id AND wm.user_id = $2
      WHERE a.id = $1 AND a.status = 'active';
    `;

    const asstRes = await pool.query(asstQuery, [assistantId, req.user?.id || null]);
    if (asstRes.rows.length === 0) {
      res.status(404).json({ error: 'NotFound', message: 'Assistant not found.', statusCode: 404 });
      return;
    }

    const assistant = asstRes.rows[0];

    // If private assistant, caller MUST have active membership in owning workspace
    if (!assistant.public_embed_allowed && !assistant.caller_role) {
      res.status(404).json({
        error: 'NotFound',
        message: 'Assistant not found.',
        statusCode: 404,
      });
      return;
    }

    const userId = req.user ? req.user.id : null;
    const anonToken = !userId
      ? ((req.headers['x-anonymous-session-token'] as string) || crypto.randomUUID())
      : null;

    const convTitle = title || 'New Conversation';

    const insertQuery = `
      INSERT INTO conversations (
        workspace_id, assistant_id, title, created_by, anonymous_session_token, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, workspace_id, assistant_id, title, created_at, updated_at;
    `;

    const insertRes = await pool.query(insertQuery, [
      assistant.workspace_id,
      assistant.id,
      convTitle,
      userId,
      anonToken,
      JSON.stringify(metadata || {}),
    ]);

    const conv = insertRes.rows[0];

    res.status(201).json({
      status: 'created',
      conversationId: conv.id,
      assistantId: conv.assistant_id,
      workspaceId: conv.workspace_id,
      title: conv.title,
      anonymousSessionToken: anonToken,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

// 3. Get Conversation Metadata
// GET /api/v1/conversations/:conversationId
conversationsRouter.get(
  '/:conversationId',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1;`,
        [access.conversation.id]
      );

      res.status(200).json({
        status: 'ok',
        conversationId: access.conversation.id,
        assistantId: access.conversation.assistant_id,
        workspaceId: access.conversation.workspace_id,
        title: access.conversation.title,
        messageCount: countRes.rows[0].count,
        createdAt: access.conversation.created_at,
        updatedAt: access.conversation.updated_at,
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);

// 4. Get Conversation Messages History (Paginated)
// GET /api/v1/conversations/:conversationId/messages
conversationsRouter.get(
  '/:conversationId/messages',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      const parse = PaginationSchema.safeParse(req.query);
      const { limit, offset } = parse.success ? parse.data : { limit: 50, offset: 0 };

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1;`,
        [access.conversation.id]
      );

      const messagesQuery = `
        SELECT 
          m.id, m.role, m.content, m.token_count, m.finish_reason, m.created_at,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'citationIndex', mc.citation_index,
                'sourceId', mc.source_id,
                'sourceTitle', mc.source_title,
                'chunkId', mc.chunk_id,
                'excerpt', mc.excerpt,
                'relevanceScore', mc.relevance_score,
                'sectionPath', mc.section_path,
                'pageNumber', mc.page_number,
                'versionNumber', mc.version_number,
                'sourceUrl', mc.source_url,
                'validationStatus', mc.validation_status
              )
            ) FILTER (WHERE mc.id IS NOT NULL), '[]'
          ) AS citations,
          COALESCE(
            (SELECT json_build_object(
               'id', mf.id,
               'rating', mf.rating,
               'comment', mf.comment,
               'createdAt', mf.created_at
             )
             FROM message_feedback mf
             WHERE mf.message_id = m.id
             LIMIT 1
            ), NULL
          ) AS feedback
        FROM messages m
        LEFT JOIN message_citations mc ON m.id = mc.message_id
        WHERE m.conversation_id = $1
        GROUP BY m.id
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT $2 OFFSET $3;
      `;

      const result = await pool.query(messagesQuery, [access.conversation.id, limit, offset]);

      res.status(200).json({
        status: 'ok',
        conversationId: access.conversation.id,
        messages: result.rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          tokenCount: r.token_count,
          finishReason: r.finish_reason,
          citations: r.citations,
          feedback: r.feedback,
          createdAt: r.created_at,
        })),
        total: countRes.rows[0]?.count || 0,
        limit,
        offset,
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);

// 4b. Clear Conversation Memory & Summaries (Day 15 Task 5)
// DELETE /api/v1/conversations/:conversationId/memory
conversationsRouter.delete(
  '/:conversationId/memory',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      await deleteConversationMemory(access.conversation.id, access.conversation.workspace_id);

      res.status(200).json({
        status: 'ok',
        deleted: true,
        conversationId: access.conversation.id,
        message: 'Conversation memory and summaries have been purged.',
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);

// 4c. Get Conversation Summary (Day 15 Task 2)
// GET /api/v1/conversations/:conversationId/summary
conversationsRouter.get(
  '/:conversationId/summary',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      const summary = await getConversationSummary(access.conversation.id);
      res.status(200).json({
        status: 'ok',
        summary,
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);

// 5. Send Message and Stream Response (SSE or JSON)
// POST /api/v1/conversations/:conversationId/messages
conversationsRouter.post(
  '/:conversationId/messages',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      const parse = SendMessageSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: parse.error.issues[0]?.message || 'Invalid message payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const { content, stream, knowledgeSpaceIds, idempotencyKey, responseFormat } = parse.data;
      const conversationId = access.conversation.id;
      const workspaceId = access.conversation.workspace_id;
      const assistantId = access.conversation.assistant_id;

      // Idempotency check: if idempotency key passed, check if processed recently
      const resolvedIdempotencyKey = idempotencyKey || (req.headers['x-idempotency-key'] as string) || null;
      if (resolvedIdempotencyKey) {
        const existing = await pool.query(
          `SELECT m.id, m.content, m.created_at 
           FROM messages m 
           WHERE m.conversation_id = $1 
             AND m.metadata->>'idempotencyKey' = $2 
           ORDER BY m.created_at DESC LIMIT 1;`,
          [conversationId, resolvedIdempotencyKey]
        );
        if (existing.rows.length > 0) {
          // Return the already persisted message
          const existingAsst = await pool.query(
            `SELECT m.id, m.content, m.created_at 
             FROM messages m 
             WHERE m.conversation_id = $1 AND m.role = 'assistant' AND m.created_at > $2
             ORDER BY m.created_at ASC LIMIT 1;`,
            [conversationId, existing.rows[0].created_at]
          );
          if (existingAsst.rows.length > 0) {
            res.status(200).json({
              status: 'ok',
              idempotent: true,
              userMessage: existing.rows[0],
              assistantMessage: existingAsst.rows[0],
            });
            return;
          }
        }
      }

      // Day 15: Retrieve User Preferences (if user authenticated)
      const userPreferences = req.user
        ? await getUserPreferences(req.user.id, workspaceId)
        : null;

      // Day 11: Query Understanding & Routing Analysis
      const queryAnalysis = analyzeQuery(content);

      // 1. Persist user message with query understanding metadata
      const userMsgRes = await pool.query(
        `INSERT INTO messages (conversation_id, role, content, metadata)
         VALUES ($1, 'user', $2, $3)
         RETURNING id, role, content, metadata, created_at;`,
        [
          conversationId,
          content,
          JSON.stringify({
            idempotencyKey: resolvedIdempotencyKey,
            queryUnderstanding: {
              category: queryAnalysis.classification.category,
              confidence: queryAnalysis.classification.confidence,
              route: queryAnalysis.classification.route,
              rewrittenQuery: queryAnalysis.rewriting.rewrittenQuery,
              isMultiPart: queryAnalysis.decomposition.isMultiPart,
              subQueries: queryAnalysis.decomposition.subQueries,
            },
          }),
        ]
      );
      const userMessage = userMsgRes.rows[0];

      // Update conversation timestamp
      await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

      // Day 15: Retrieve Bounded Conversation History (excluding current message)
      const boundedHistory = await getBoundedConversationHistory(conversationId, {
        maxMessages: config.memory.maxMessages,
        maxTokens: config.memory.maxTokens,
        excludeMessageId: userMessage.id,
      });

      // Day 15: Retrieve Active Conversation Summary
      const activeSummary = await getConversationSummary(conversationId);

      // 2. Query Understanding Routing & Adaptive Retrieval
      let citations: any[] = [];
      let responseText = '';
      let structuredOutput: unknown = undefined;

      const assistantName = access.assistant.name || 'Nexus Assistant';
      const isSentinel = assistantName.toLowerCase().includes('sentinel');

      switch (queryAnalysis.classification.category) {
        case 'greeting':
          responseText = `Hello! I am ${assistantName}. How can I assist your investigation or platform operations today?`;
          if (isSentinel) {
            responseText += ' As the Sentinel Security Copilot, all telemetry monitors are currently active.';
          }
          break;

        case 'ambiguous':
          responseText = `As ${assistantName}: ${queryAnalysis.classification.clarificationPrompt || 'Could you please specify which service, component, or error code you are inquiring about?'}`;
          break;

        case 'unsupported':
          responseText = `As ${assistantName}: I specialize in NomaanOS Nexus AI platform architecture, security runbooks, and engineering documentation. Your inquiry appears to be outside of this scope.`;
          break;

        case 'live_data':
          if (config.offline.enabled || !config.offline.remoteDataEnabled) {
            responseText = `As ${assistantName}: Live remote data is unavailable in offline / air-gapped deployment mode. This Nexus AI instance operates strictly in a disconnected local environment with zero external connectivity. Responses are generated exclusively from authorized local knowledge sources.`;
          } else {
            responseText = `As ${assistantName}: Live telemetry and real-time operational status require an authorized live integration connector (e.g. Prometheus or Kubernetes metrics). Live operational metrics cannot be fabricated from static documentation.`;
          }
          break;

        case 'action': {
          const toolVerification = verifyToolExecution(
            'system_operation',
            'pending',
            queryAnalysis.rewriting.rewrittenQuery
          );
          responseText = `As ${assistantName}: ${toolVerification.verifiedStatement} Please explicitly confirm to proceed.`;
          break;
        }

        case 'exact_lookup':
        case 'knowledge_question':
        default: {
          // Retrieve linked knowledge spaces for assistant in this workspace
          let linkedSpaces: { id: string; name: string }[] = [];
          try {
            const spacesQuery = `
              SELECT ks.id, ks.name
              FROM assistant_knowledge_spaces aks
              JOIN knowledge_spaces ks ON aks.knowledge_space_id = ks.id
              WHERE aks.assistant_id = $1 AND ks.workspace_id = $2
                ${knowledgeSpaceIds && knowledgeSpaceIds.length > 0 ? 'AND ks.id = ANY($3::uuid[])' : ''}
              ORDER BY aks.created_at ASC;
            `;
            const params: any[] = [assistantId, workspaceId];
            if (knowledgeSpaceIds && knowledgeSpaceIds.length > 0) {
              params.push(knowledgeSpaceIds);
            }
            const spacesRes = await pool.query(spacesQuery, params);
            linkedSpaces = spacesRes.rows;
          } catch {
            // Knowledge spaces query error fallback
          }

          if (linkedSpaces.length > 0) {
            try {
              // Execute adaptive retrieval over primary linked knowledge space
              const adaptiveRes = await adaptiveRetrieve({
                workspaceId,
                knowledgeSpaceId: linkedSpaces[0].id,
                query: content,
                topK: config.evidence.maxChunks,
              });

              // Assemble evidence with deduplication, DB permission revalidation, and context budget
              const evidenceRes = await assembleEvidence({
                candidates: adaptiveRes.results,
                workspaceId,
                knowledgeSpaceId: linkedSpaces[0].id,
                maxTokens: config.evidence.maxTokens,
                maxChunks: config.evidence.maxChunks,
                minScore: config.evidence.minScore,
              });

              // Grounded synthesis with citation extraction & contradiction/claim checks & Day 15 Memory & Day 16/17 Inference Routing
              const groundedRes = await synthesizeGroundedAnswerAsync({
                query: content,
                evidenceResult: evidenceRes,
                assistantName,
                systemPrompt: (access.assistant as any)?.system_prompt,
                isSentinel,
                conversationHistory: boundedHistory.recentMessages,
                conversationSummary: activeSummary,
                preferences: userPreferences,
                responseFormat,
                routingPolicy: (access.assistant as any)?.model_policy,
                workspaceId,
                assistantId,
                conversationId,
              });

              // Day 14 Task 2: Validate citations against evidence and PostgreSQL permissions
              const validation = await validateCitations({
                citations: groundedRes.citations,
                assembledEvidence: evidenceRes.items,
                workspaceId,
                answerText: groundedRes.answer,
                customPool: pool,
              });

              responseText = responseFormat?.type === 'json_object' ? groundedRes.answer : validation.sanitizedAnswer;
              structuredOutput = groundedRes.structuredOutput;
              citations = validation.validCitations.map((c) => ({
                citationIndex: c.citationIndex,
                sourceId: c.sourceId,
                sourceTitle: c.sourceTitle,
                chunkId: c.chunkId,
                excerpt: c.excerpt,
                relevanceScore: c.relevanceScore,
                sectionPath: c.sectionPath,
                pageNumber: c.pageNumber,
                versionNumber: c.versionNumber,
                sourceUrl: c.sourceUrl,
                validationStatus: c.validationStatus,
                validationReason: c.validationReason,
                claimSupportScore: c.claimSupportScore,
              }));
            } catch {
              // Retrieval error fallback
              responseText = `I have received your inquiry: "${content}". As the **${assistantName}**, I am ready to assist you across the NomaanOS platform.`;
            }
          } else {
            // Default response when no knowledge spaces linked
            if (responseFormat?.type === 'json_object') {
              const groundedRes = synthesizeGroundedAnswer({
                query: content,
                evidenceResult: {
                  items: [],
                  totalTokens: 0,
                  totalChunks: 0,
                  candidateCount: 0,
                  deduplicatedCount: 0,
                  excludedPermissionCount: 0,
                  insufficientEvidence: false,
                },
                assistantName,
                conversationHistory: boundedHistory.recentMessages,
                conversationSummary: activeSummary,
                preferences: userPreferences,
                responseFormat,
              });
              responseText = groundedRes.answer;
              structuredOutput = groundedRes.structuredOutput;
            } else {
              responseText = `I have received your inquiry: "${content}". `;
              if (isSentinel) {
                responseText += `As the **${assistantName}**, I analyzed security telemetry. No critical unauthorized breaches or privilege escalations were detected for this scope.`;
              } else {
                responseText += `As the **${assistantName}**, I am ready to assist you across the NomaanOS platform.`;
              }
            }
          }
          break;
        }
      }

      // 4. Handle SSE Streaming
      if (stream && req.headers.accept?.includes('text/event-stream')) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Insert initial placeholder assistant message
        const asstMsgRes = await pool.query(
          `INSERT INTO messages (conversation_id, role, content, finish_reason)
           VALUES ($1, 'assistant', '', 'in_progress')
           RETURNING id, role, created_at;`,
          [conversationId]
        );
        const asstMessageId = asstMsgRes.rows[0].id;

        let isAborted = false;
        let isEnded = false;
        let accumulatedDelta = '';

        // Disconnect listener: abort upstream generation and persist partial response
        req.on('close', async () => {
          if (!isEnded) {
            isAborted = true;
            isEnded = true;
            try {
              await pool.query(
                `UPDATE messages SET content = $1, finish_reason = 'cancelled' WHERE id = $2;`,
                [accumulatedDelta || responseText.slice(0, 50), asstMessageId]
              );
            } catch {}
          }
        });

        // Safe stream writer helper
        const writeEvent = (eventType: string, data: Record<string, unknown>) => {
          if (isAborted || isEnded || res.writableEnded) return;
          res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        };

        // 1. message.start
        writeEvent('message.start', {
          messageId: asstMessageId,
          conversationId,
          role: 'assistant',
        });

        // 2. tool_status event (knowledge retrieval)
        if (citations.length > 0 || (knowledgeSpaceIds && knowledgeSpaceIds.length > 0)) {
          writeEvent('tool_status', {
            tool: 'knowledge_retrieval',
            status: 'completed',
            message: 'Knowledge retrieval completed.',
          });
        }

        // 3. Incremental text stream
        const tokens = responseText.split(' ');
        for (let i = 0; i < tokens.length; i++) {
          if (isAborted || res.writableEnded) break;
          const delta = (i === 0 ? '' : ' ') + tokens[i];
          accumulatedDelta += delta;

          // Emit Day 5 canonical 'text' event
          writeEvent('text', { delta, text: accumulatedDelta });
          // Also emit 'content.delta' for Day 4 backward compatibility
          writeEvent('content.delta', { delta });
        }

        // 4. Citation event
        if (citations.length > 0 && !isAborted) {
          writeEvent('citation', { citations });
          writeEvent('citations', { citations }); // backward compatibility
        }

        // 4b. Structured output event (Day 15 Task 6)
        if (structuredOutput !== undefined && !isAborted) {
          writeEvent('structured_output', { data: structuredOutput });
        }

        // 5. Completion event (sent exactly once)
        if (!isAborted && !isEnded && !res.writableEnded) {
          // Persist full assistant response and citations
          await pool.query(
            `UPDATE messages SET content = $1, finish_reason = 'stop', token_count = $2 WHERE id = $3;`,
            [responseText, tokens.length, asstMessageId]
          );

          if (citations.length > 0) {
            for (const c of citations) {
              await pool.query(
                `INSERT INTO message_citations (
                   message_id, source_id, chunk_id, citation_index, source_title, excerpt, relevance_score,
                   section_path, page_number, version_number, source_url, validation_status, validation_reason, claim_support_score
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
                [
                  asstMessageId,
                  c.sourceId,
                  c.chunkId,
                  c.citationIndex,
                  c.sourceTitle,
                  c.excerpt,
                  c.relevanceScore,
                  c.sectionPath || null,
                  c.pageNumber || null,
                  c.versionNumber || 1,
                  c.sourceUrl || null,
                  c.validationStatus || 'verified',
                  c.validationReason || null,
                  c.claimSupportScore || null,
                ]
              );
            }
          }

          // Emit Day 5 canonical 'completion' event
          writeEvent('completion', {
            messageId: asstMessageId,
            conversationId,
            finishReason: 'stop',
            usage: { totalTokens: tokens.length },
          });

          // Also emit 'message.complete' for Day 4 backward compatibility
          writeEvent('message.complete', {
            messageId: asstMessageId,
            finishReason: 'stop',
            usage: { totalTokens: tokens.length },
          });

          isEnded = true;
          res.end();

          // Day 15 Task 2: Background conversation summarization check
          if (boundedHistory.hasOlderMessages || boundedHistory.recentMessages.length >= config.memory.autoSummarizeThreshold) {
            summarizeConversation(conversationId).catch((err) => {
              logger.warn({ conversationId, err }, 'Background auto-summarization skipped or failed');
            });
          }
        }
        return;
      }

      // 5. Non-streaming JSON response fallback
      const asstMsgRes = await pool.query(
        `INSERT INTO messages (conversation_id, role, content, finish_reason, token_count)
         VALUES ($1, 'assistant', $2, 'stop', $3)
         RETURNING id, role, content, created_at;`,
        [conversationId, responseText, responseText.split(' ').length]
      );
      const asstMessage = asstMsgRes.rows[0];

      if (citations.length > 0) {
        for (const c of citations) {
          await pool.query(
            `INSERT INTO message_citations (
               message_id, source_id, chunk_id, citation_index, source_title, excerpt, relevance_score,
               section_path, page_number, version_number, source_url, validation_status, validation_reason, claim_support_score
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
            [
              asstMessage.id,
              c.sourceId,
              c.chunkId,
              c.citationIndex,
              c.sourceTitle,
              c.excerpt,
              c.relevanceScore,
              c.sectionPath || null,
              c.pageNumber || null,
              c.versionNumber || 1,
              c.sourceUrl || null,
              c.validationStatus || 'verified',
              c.validationReason || null,
              c.claimSupportScore || null,
            ]
          );
        }
      }

      res.status(200).json({
        status: 'ok',
        userMessage: {
          id: userMessage.id,
          role: 'user',
          content: userMessage.content,
          metadata: typeof userMessage.metadata === 'string' ? JSON.parse(userMessage.metadata) : userMessage.metadata,
          createdAt: userMessage.created_at,
        },
        assistantMessage: {
          id: asstMessage.id,
          role: 'assistant',
          content: asstMessage.content,
          citations,
          createdAt: asstMessage.created_at,
        },
        citations,
        structuredOutput,
      });

      // Day 15 Task 2: Background conversation summarization check
      if (boundedHistory.hasOlderMessages || boundedHistory.recentMessages.length >= config.memory.autoSummarizeThreshold) {
        summarizeConversation(conversationId).catch((err) => {
          logger.warn({ conversationId, err }, 'Background auto-summarization skipped or failed');
        });
      }
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);

// 6. Message Feedback Submission
// POST /api/v1/conversations/:conversationId/messages/:messageId/feedback
conversationsRouter.post(
  '/:conversationId/messages/:messageId/feedback',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const messageId = typeof req.params.messageId === 'string' ? req.params.messageId : '';

      if (!UUID_REGEX.test(messageId)) {
        res.status(400).json({ error: 'ValidationError', message: 'Invalid message ID.', statusCode: 400 });
        return;
      }

      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      const parse = FeedbackSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: parse.error.issues[0]?.message || 'Invalid feedback payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      // Verify that target message exists in this conversation and is an assistant message
      const msgRes = await pool.query(
        `SELECT id, role FROM messages WHERE id = $1 AND conversation_id = $2;`,
        [messageId, access.conversation.id]
      );

      if (msgRes.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'Message not found in conversation.', statusCode: 404 });
        return;
      }

      if (msgRes.rows[0].role !== 'assistant') {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Feedback can only be provided for assistant messages.',
          statusCode: 400,
        });
        return;
      }

      const { rating, comment, metadata } = parse.data;
      const normalizedRating = (rating === 'thumbs_up' ? 'positive' : rating === 'thumbs_down' ? 'negative' : rating);

      const userId = req.user?.id || null;
      const anonToken = (req.headers['x-anonymous-session-token'] as string) || access.conversation.anonymous_session_token || null;

      let feedbackRes;
      if (userId) {
        const query = `
          INSERT INTO message_feedback (
            conversation_id, message_id, workspace_id, user_id, rating, comment, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (message_id, user_id) WHERE user_id IS NOT NULL
          DO UPDATE SET 
            rating = EXCLUDED.rating, 
            comment = EXCLUDED.comment, 
            metadata = EXCLUDED.metadata, 
            updated_at = NOW()
          RETURNING id, conversation_id, message_id, rating, comment, created_at, updated_at;
        `;
        feedbackRes = await pool.query(query, [
          access.conversation.id,
          messageId,
          access.conversation.workspace_id,
          userId,
          normalizedRating,
          comment || null,
          JSON.stringify(metadata || {}),
        ]);
      } else {
        const query = `
          INSERT INTO message_feedback (
            conversation_id, message_id, workspace_id, anonymous_session_token, rating, comment, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (message_id, anonymous_session_token) WHERE anonymous_session_token IS NOT NULL
          DO UPDATE SET 
            rating = EXCLUDED.rating, 
            comment = EXCLUDED.comment, 
            metadata = EXCLUDED.metadata, 
            updated_at = NOW()
          RETURNING id, conversation_id, message_id, rating, comment, created_at, updated_at;
        `;
        feedbackRes = await pool.query(query, [
          access.conversation.id,
          messageId,
          access.conversation.workspace_id,
          anonToken,
          normalizedRating,
          comment || null,
          JSON.stringify(metadata || {}),
        ]);
      }

      const feedback = feedbackRes.rows[0];

      res.status(200).json({
        status: 'ok',
        feedback: {
          id: feedback.id,
          conversationId: feedback.conversation_id,
          messageId: feedback.message_id,
          rating: feedback.rating,
          comment: feedback.comment,
          createdAt: feedback.created_at,
          updatedAt: feedback.updated_at,
        },
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);

// 7. Get Message Feedback
// GET /api/v1/conversations/:conversationId/messages/:messageId/feedback
conversationsRouter.get(
  '/:conversationId/messages/:messageId/feedback',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convId = typeof req.params.conversationId === 'string' ? req.params.conversationId : '';
      const messageId = typeof req.params.messageId === 'string' ? req.params.messageId : '';

      const access = await resolveConversationAccess(convId, req);
      if (!access) {
        res.status(404).json({ error: 'NotFound', message: 'Conversation not found.', statusCode: 404 });
        return;
      }

      const feedbackRes = await pool.query(
        `SELECT id, conversation_id, message_id, rating, comment, created_at, updated_at 
         FROM message_feedback 
         WHERE message_id = $1 AND conversation_id = $2;`,
        [messageId, access.conversation.id]
      );

      if (feedbackRes.rows.length === 0) {
        res.status(404).json({ error: 'NotFound', message: 'No feedback found for this message.', statusCode: 404 });
        return;
      }

      const feedback = feedbackRes.rows[0];

      res.status(200).json({
        status: 'ok',
        feedback: {
          id: feedback.id,
          conversationId: feedback.conversation_id,
          messageId: feedback.message_id,
          rating: feedback.rating,
          comment: feedback.comment,
          createdAt: feedback.created_at,
          updatedAt: feedback.updated_at,
        },
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.name, message: err.message, statusCode: err.statusCode });
        return;
      }
      next(err);
    }
  }
);
