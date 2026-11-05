/**
 * NomaanOS Nexus AI - Permission-Aware Tool Execution Engine (Day 19)
 *
 * Implements:
 * 1. Separation of proposals from execution (proposals are untrusted requests).
 * 2. Trusted server-side authorization and immediate role revalidation.
 * 3. Schema-driven argument validation.
 * 4. Per-tool timeout and AbortSignal cancellation support.
 * 5. Output contract validation.
 * 6. Audit recording into PostgreSQL `tool_execution_records` with sanitized arguments.
 */

import {
  ToolCallProposal,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolExecutionStatus,
  isRoleSufficient,
} from '@nomaanos/nexus-shared-types';
import { ToolRegistry } from './tool-registry.js';
import {
  validateToolProposal,
  validateToolResult,
  sanitizeToolArguments,
} from './tool-validator.js';
import { pool } from '../../database/pool.js';
import { logger } from '../../config/logger.js';

export interface ExecuteToolOptions {
  proposal: ToolCallProposal;
  context: ToolExecutionContext;
  registry?: ToolRegistry;
  timeoutMs?: number;
}

export class ToolExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: ToolExecutionStatus = 'failed'
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

/**
 * Persists a tool execution record into PostgreSQL for auditability and compliance.
 */
async function recordToolExecution(entry: {
  workspaceId: string;
  userId?: string | null;
  assistantId?: string | null;
  conversationId?: string | null;
  toolName: string;
  status: ToolExecutionStatus;
  durationMs: number;
  correlationId?: string | null;
  sanitizedArguments: Record<string, unknown>;
  outputSummary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<string | null> {
  try {
    const res = await pool.query(
      `INSERT INTO tool_execution_records (
         workspace_id, user_id, assistant_id, conversation_id,
         tool_name, status, duration_ms, correlation_id,
         sanitized_arguments, output_summary, error_code, error_message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id;`,
      [
        entry.workspaceId,
        entry.userId || null,
        entry.assistantId || null,
        entry.conversationId || null,
        entry.toolName,
        entry.status,
        entry.durationMs,
        entry.correlationId || null,
        JSON.stringify(entry.sanitizedArguments),
        entry.outputSummary || null,
        entry.errorCode || null,
        entry.errorMessage || null,
      ]
    );
    return res.rows[0]?.id || null;
  } catch (err: any) {
    logger.warn({ err: err.message, tool: entry.toolName }, 'Failed to insert tool execution record in DB');
    return null;
  }
}

/**
 * Executes a single tool call proposal under strict validation and trusted authorization.
 */
export async function executeTool(options: ExecuteToolOptions): Promise<ToolExecutionResult> {
  const { proposal, context, registry = ToolRegistry.getInstance(), timeoutMs } = options;
  const startTime = Date.now();
  const sanitizedArgs = sanitizeToolArguments(proposal.arguments || {});

  // 1. Verify caller context has required workspace context
  if (!context || !context.workspaceId) {
    const durationMs = Date.now() - startTime;
    return {
      callId: proposal.callId,
      toolName: proposal.toolName,
      status: 'rejected_unauthorized',
      error: 'Trusted server-side workspace context is missing.',
      errorCode: 'MISSING_WORKSPACE_CONTEXT',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Lookup tool in registry
  const tool = registry.getTool(proposal.toolName);
  if (!tool) {
    const durationMs = Date.now() - startTime;
    const errorMsg = `Tool '${proposal.toolName}' is not registered or permitted in this environment.`;

    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: proposal.toolName,
      status: 'rejected_unauthorized',
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      errorCode: 'UNKNOWN_TOOL',
      errorMessage: errorMsg,
    });

    return {
      callId: proposal.callId,
      toolName: proposal.toolName,
      status: 'rejected_unauthorized',
      error: errorMsg,
      errorCode: 'UNKNOWN_TOOL',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  if (tool.enabled === false) {
    const durationMs = Date.now() - startTime;
    const errorMsg = `Tool '${proposal.toolName}' is currently disabled by platform policy.`;

    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: proposal.toolName,
      status: 'rejected_unauthorized',
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      errorCode: 'TOOL_DISABLED',
      errorMessage: errorMsg,
    });

    return {
      callId: proposal.callId,
      toolName: proposal.toolName,
      status: 'rejected_unauthorized',
      error: errorMsg,
      errorCode: 'TOOL_DISABLED',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  // 3. Permission & Role Enforcement
  const userRole = context.role || 'viewer';
  const requiredRole = tool.requiredRole || 'viewer';
  if (!isRoleSufficient(userRole, requiredRole)) {
    const durationMs = Date.now() - startTime;
    const errorMsg = `Permission denied: Tool '${tool.name}' requires role '${requiredRole}', but caller has role '${userRole}'.`;

    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: tool.name,
      status: 'rejected_unauthorized',
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      errorCode: 'INSUFFICIENT_ROLE',
      errorMessage: errorMsg,
    });

    return {
      callId: proposal.callId,
      toolName: tool.name,
      status: 'rejected_unauthorized',
      error: errorMsg,
      errorCode: 'INSUFFICIENT_ROLE',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  // 4. Input Argument Validation
  const validation = validateToolProposal(proposal, tool);
  if (!validation.isValid) {
    const durationMs = Date.now() - startTime;

    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: tool.name,
      status: 'validation_error',
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      errorCode: 'ARGUMENT_VALIDATION_ERROR',
      errorMessage: validation.error,
    });

    return {
      callId: proposal.callId,
      toolName: tool.name,
      status: 'validation_error',
      error: validation.error,
      errorCode: 'ARGUMENT_VALIDATION_ERROR',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  // 5. Check if request was already cancelled before execution begins
  if (context.signal?.aborted) {
    const durationMs = Date.now() - startTime;
    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: tool.name,
      status: 'cancelled',
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      errorCode: 'REQUEST_CANCELLED',
      errorMessage: 'Operation was cancelled by client before tool execution began.',
    });

    return {
      callId: proposal.callId,
      toolName: tool.name,
      status: 'cancelled',
      error: 'Operation was cancelled.',
      errorCode: 'REQUEST_CANCELLED',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  // 6. Setup Execution Timeout & Combined AbortSignal
  const effectiveTimeout = timeoutMs || tool.timeoutMs || 5000;
  const abortController = new AbortController();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort(new Error(`Tool execution timed out after ${effectiveTimeout}ms`));
  }, effectiveTimeout);

  const onParentAbort = () => {
    abortController.abort(context.signal?.reason || new Error('Request cancelled by caller'));
  };

  if (context.signal) {
    context.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  // 7. Execute Handler
  try {
    if (!tool.handler) {
      throw new Error(`Tool '${tool.name}' does not have an execution handler implemented.`);
    }

    const toolExecutionContext: ToolExecutionContext = {
      ...context,
      signal: abortController.signal,
    };

    const timeoutPromise = new Promise((_, reject) => {
      abortController.signal.addEventListener(
        'abort',
        () => {
          if (timedOut) {
            reject(new Error(`Tool execution timed out after ${effectiveTimeout}ms`));
          } else {
            reject(new Error('Operation was cancelled by client.'));
          }
        },
        { once: true }
      );
    });

    const rawOutput = await Promise.race([
      tool.handler(validation.data, toolExecutionContext),
      timeoutPromise,
    ]);

    // 8. Output Contract Validation
    const outputValidation = validateToolResult(rawOutput, tool);
    if (!outputValidation.isValid) {
      throw new Error(outputValidation.error);
    }

    const durationMs = Date.now() - startTime;
    const outputSummary = typeof rawOutput === 'object' && rawOutput !== null
      ? JSON.stringify(rawOutput).slice(0, 1024)
      : String(rawOutput).slice(0, 1024);

    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: tool.name,
      status: 'success',
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      outputSummary,
    });

    return {
      callId: proposal.callId,
      toolName: tool.name,
      status: 'success',
      output: outputValidation.data,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isCancelled = context.signal?.aborted && !timedOut;
    const status: ToolExecutionStatus = timedOut
      ? 'timed_out'
      : isCancelled
      ? 'cancelled'
      : 'failed';

    const errorCode = timedOut ? 'TIMEOUT' : isCancelled ? 'CANCELLED' : 'EXECUTION_FAILED';
    const errorMessage = err?.message || 'Tool execution encountered an unexpected error.';

    await recordToolExecution({
      workspaceId: context.workspaceId,
      userId: context.userId,
      assistantId: context.assistantId,
      conversationId: context.conversationId,
      toolName: tool.name,
      status,
      durationMs,
      correlationId: context.correlationId,
      sanitizedArguments: sanitizedArgs,
      errorCode,
      errorMessage,
    });

    return {
      callId: proposal.callId,
      toolName: tool.name,
      status,
      error: errorMessage,
      errorCode,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
    if (context.signal) {
      context.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
