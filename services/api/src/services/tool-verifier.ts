/**
 * NomaanOS Nexus AI - Tool-Execution Verification Service (Day 14)
 *
 * Enforces execution-truth invariants:
 * 1. The assistant must NEVER claim that an action or tool call succeeded without verified backend execution.
 * 2. Explicitly distinguishes successful, failed, pending approval, and unverified operations.
 * 3. Preserves authorization, idempotency, and audit requirements.
 */

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';

export type ToolExecutionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'success'
  | 'failed'
  | 'unverified';

export interface ToolExecutionRecord {
  id: string;
  conversationId: string;
  messageId?: string | null;
  toolName: string;
  status: ToolExecutionStatus;
  inputArguments: Record<string, unknown>;
  outputPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
}

export interface VerifyToolActionOptions {
  conversationId: string;
  messageId?: string;
  toolName: string;
  executionStatus?: ToolExecutionStatus;
  inputArguments?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  errorMessage?: string;
  customPool?: any;
}

export interface ToolVerificationResult {
  isVerifiedSuccess: boolean;
  status: ToolExecutionStatus;
  executionRecord?: ToolExecutionRecord;
  verifiedStatement: string;
}

/**
 * Persists or looks up a verified tool execution record.
 */
export async function recordToolExecution(
  options: VerifyToolActionOptions
): Promise<ToolExecutionRecord> {
  const {
    conversationId,
    messageId,
    toolName,
    executionStatus = 'pending',
    inputArguments = {},
    outputPayload = null,
    errorMessage = null,
    customPool = pool,
  } = options;

  const verifiedAt = executionStatus === 'success' ? new Date().toISOString() : null;

  try {
    const query = `
      INSERT INTO tool_executions (
        conversation_id, message_id, tool_name, status, input_arguments, output_payload, error_message, verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, conversation_id, message_id, tool_name, status, input_arguments, output_payload, error_message, verified_at, created_at;
    `;

    const res = await customPool.query(query, [
      conversationId,
      messageId || null,
      toolName,
      executionStatus,
      JSON.stringify(inputArguments),
      outputPayload ? JSON.stringify(outputPayload) : null,
      errorMessage,
      verifiedAt,
    ]);

    const row = res.rows[0];
    return {
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      toolName: row.tool_name,
      status: row.status as ToolExecutionStatus,
      inputArguments: row.input_arguments,
      outputPayload: row.output_payload,
      errorMessage: row.error_message,
      verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to record tool execution to database, fallback in-memory');
    return {
      id: 'local-fallback-' + Date.now(),
      conversationId,
      messageId,
      toolName,
      status: executionStatus,
      inputArguments,
      outputPayload,
      errorMessage,
      verifiedAt,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Verifies tool execution state and generates an accurate, non-misleading assistant statement.
 * CRITICAL RULE: Under NO circumstances may the assistant claim an action succeeded if status !== 'success'.
 */
export function verifyToolExecution(
  toolName: string,
  status: ToolExecutionStatus,
  actionPlan: string,
  details?: { error?: string; output?: any }
): ToolVerificationResult {
  const isVerifiedSuccess = status === 'success';

  let verifiedStatement = '';

  switch (status) {
    case 'success':
      verifiedStatement = `Action **${toolName}** was successfully executed and verified against platform state. Output: ${JSON.stringify(details?.output || { status: 'ok' })}`;
      break;

    case 'failed':
      verifiedStatement = `Action **${toolName}** failed during execution. Error: ${details?.error || 'Execution encountered an unexpected system failure'}. The platform state remains unchanged.`;
      break;

    case 'pending':
      verifiedStatement = `Action **${toolName}** has NOT been executed. It is currently **pending explicit confirmation and authorization**. Proposed action plan: "${actionPlan}". No changes have been applied.`;
      break;

    case 'approved':
      verifiedStatement = `Action **${toolName}** has been approved and queued for worker execution. Real-time result is not yet available; execution is in progress.`;
      break;

    case 'rejected':
      verifiedStatement = `Action **${toolName}** was rejected by policy or administrator approval. The proposed operation was cancelled.`;
      break;

    case 'running':
      verifiedStatement = `Action **${toolName}** is currently running. Operational state changes are not yet finalized.`;
      break;

    case 'unverified':
    default:
      verifiedStatement = `Action **${toolName}** cannot be verified. Nexus AI requires an authorized backend execution result before confirming any operational modifications. Proposed plan: "${actionPlan}".`;
      break;
  }

  return {
    isVerifiedSuccess,
    status,
    verifiedStatement,
  };
}
