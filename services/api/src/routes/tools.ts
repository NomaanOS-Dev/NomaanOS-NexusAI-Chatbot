/**
 * NomaanOS Nexus AI - Tool Registry & Execution API Routes (Day 19)
 *
 * Provides:
 * 1. GET /api/v1/tools - Lists authorized approved tools for caller's workspace & role.
 * 2. POST /api/v1/tools/execute - Controlled single tool proposal execution with schema and role enforcement.
 * 3. GET /api/v1/tools/executions - Paginated tool execution and audit records.
 * 4. POST /api/v1/agent/run - Runs the bounded controlled agent loop.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { pool } from '../database/pool.js';
import { ToolRegistry } from '../services/tools/tool-registry.js';
import { executeTool } from '../services/tools/tool-executor.js';
import { runControlledAgentLoop } from '../services/tools/agent-loop.js';
import type {
  ToolExecutionContext,
  WorkspaceRole,
  AgentLoopConfig,
} from '@nomaanos/nexus-shared-types';

export const toolsRouter = Router();

const ExecuteToolSchema = z.object({
  toolName: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
  workspaceId: z.string().uuid().optional(),
  assistantId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

const RunAgentSchema = z.object({
  query: z.string().min(1).max(2000),
  workspaceId: z.string().uuid().optional(),
  assistantId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  config: z
    .object({
      maxIterations: z.number().int().min(1).max(10).optional(),
      maxToolCalls: z.number().int().min(1).max(20).optional(),
      perToolTimeoutMs: z.number().int().min(500).max(15000).optional(),
      overallTimeoutMs: z.number().int().min(1000).max(60000).optional(),
      allowedTools: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * Resolves trusted workspace ID and user's role from database.
 */
async function resolveWorkspaceContext(
  req: Request,
  explicitWorkspaceId?: string
): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
  const userId = req.user?.id;
  if (!userId) return null;

  let targetWorkspaceId =
    explicitWorkspaceId ||
    (req.headers['x-workspace-id'] as string) ||
    req.workspace?.id;

  if (targetWorkspaceId) {
    const memRes = await pool.query(
      `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
      [targetWorkspaceId, userId]
    );
    if (memRes.rows.length === 0) {
      return null;
    }
    return {
      workspaceId: targetWorkspaceId,
      role: memRes.rows[0].role as WorkspaceRole,
    };
  }

  // Fallback to user's first available workspace
  const defaultWs = await pool.query(
    `SELECT workspace_id, role FROM workspace_memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1;`,
    [userId]
  );
  if (defaultWs.rows.length === 0) {
    return null;
  }

  return {
    workspaceId: defaultWs.rows[0].workspace_id,
    role: defaultWs.rows[0].role as WorkspaceRole,
  };
}

// ============================================================================
// 1. List Approved Tools
// GET /api/v1/tools
// ============================================================================
toolsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wsCtx = await resolveWorkspaceContext(req);
    const role: WorkspaceRole = wsCtx?.role || 'viewer';

    const registry = ToolRegistry.getInstance();
    const tools = registry.listTools({ role, enabledOnly: true });

    res.status(200).json({
      status: 'ok',
      workspaceId: wsCtx?.workspaceId || null,
      role,
      tools,
      totalCount: tools.length,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 2. Controlled Tool Proposal Execution
// POST /api/v1/tools/execute
// ============================================================================
toolsRouter.post('/execute', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parse = ExecuteToolSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid tool proposal payload',
        statusCode: 400,
        details: parse.error.issues,
      });
      return;
    }

    const { toolName, arguments: rawArgs, workspaceId: explicitWorkspaceId, assistantId, conversationId } = parse.data;

    const wsCtx = await resolveWorkspaceContext(req, explicitWorkspaceId);
    if (!wsCtx) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Caller does not have active membership in the specified workspace.',
        statusCode: 403,
      });
      return;
    }

    const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();

    const context: ToolExecutionContext = {
      userId: req.user!.id,
      workspaceId: wsCtx.workspaceId,
      role: wsCtx.role,
      correlationId,
      assistantId,
      conversationId,
    };

    const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await executeTool({
      proposal: {
        callId,
        toolName,
        arguments: rawArgs,
      },
      context,
    });

    if (result.status === 'rejected_unauthorized') {
      res.status(403).json({
        status: 'error',
        error: 'UnauthorizedToolExecution',
        message: result.error,
        result,
      });
      return;
    }

    if (result.status === 'validation_error') {
      res.status(400).json({
        status: 'error',
        error: 'InvalidToolArguments',
        message: result.error,
        result,
      });
      return;
    }

    res.status(200).json({
      status: 'ok',
      result,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 3. Paginated Tool Execution & Audit Records
// GET /api/v1/tools/executions
// ============================================================================
toolsRouter.get('/executions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wsCtx = await resolveWorkspaceContext(req, req.query.workspaceId as string);
    if (!wsCtx) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Caller does not have access to workspace audit records.',
        statusCode: 403,
      });
      return;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const status = req.query.status as string;
    const toolName = req.query.toolName as string;

    const queryParams: any[] = [wsCtx.workspaceId];
    let queryFilter = 'WHERE workspace_id = $1';

    if (status) {
      queryParams.push(status);
      queryFilter += ` AND status = $${queryParams.length}`;
    }

    if (toolName) {
      queryParams.push(toolName);
      queryFilter += ` AND tool_name = $${queryParams.length}`;
    }

    queryParams.push(limit, offset);

    const query = `
      SELECT id, workspace_id, user_id, assistant_id, conversation_id,
             tool_name, status, duration_ms, correlation_id,
             sanitized_arguments, output_summary, error_code, error_message, created_at
      FROM tool_execution_records
      ${queryFilter}
      ORDER BY created_at DESC
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length};
    `;

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tool_execution_records ${queryFilter};`,
      queryParams.slice(0, queryParams.length - 2)
    );

    const rowsRes = await pool.query(query, queryParams);

    res.status(200).json({
      status: 'ok',
      workspaceId: wsCtx.workspaceId,
      totalCount: countRes.rows[0]?.count || 0,
      limit,
      offset,
      records: rowsRes.rows.map((r: any) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        userId: r.user_id,
        assistantId: r.assistant_id,
        conversationId: r.conversation_id,
        toolName: r.tool_name,
        status: r.status,
        durationMs: r.duration_ms,
        correlationId: r.correlation_id,
        sanitizedArguments: r.sanitized_arguments || {},
        outputSummary: r.output_summary,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        createdAt: r.created_at?.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 4. Run Bounded Controlled Agent Loop
// POST /api/v1/agent/run
// ============================================================================
export const agentRouter = Router();

agentRouter.post('/run', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parse = RunAgentSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid agent request payload',
        statusCode: 400,
        details: parse.error.issues,
      });
      return;
    }

    const { query, workspaceId: explicitWorkspaceId, assistantId, conversationId, config } = parse.data;

    const wsCtx = await resolveWorkspaceContext(req, explicitWorkspaceId);
    if (!wsCtx) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Caller does not have active membership in the specified workspace.',
        statusCode: 403,
      });
      return;
    }

    const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();

    const context: ToolExecutionContext = {
      userId: req.user!.id,
      workspaceId: wsCtx.workspaceId,
      role: wsCtx.role,
      correlationId,
      assistantId,
      conversationId,
    };

    const agentResult = await runControlledAgentLoop({
      query,
      context,
      config: config as AgentLoopConfig,
    });

    res.status(200).json({
      status: 'ok',
      workspaceId: wsCtx.workspaceId,
      result: agentResult,
    });
  } catch (err) {
    next(err);
  }
});

