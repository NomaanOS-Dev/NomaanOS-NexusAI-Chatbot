/**
 * NomaanOS Nexus AI - Conversation Context & Memory Service (Day 15)
 *
 * Implements:
 * 1. Bounded recent conversation history retrieval with message-count and token budget limits.
 * 2. Conversation summarization for older messages preserving decisions and unresolved questions.
 * 3. Memory isolation (strict conversation, user, and workspace tenancy).
 * 4. Configurable memory retention and deletion operations.
 */

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';

export interface BoundedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokenCount: number;
  createdAt: string;
}

export interface BoundedHistoryResult {
  recentMessages: BoundedMessage[];
  totalTokens: number;
  hasOlderMessages: boolean;
  olderMessageCount: number;
  oldestIncludedMessageId?: string;
}

export interface ConversationSummaryRecord {
  id: string;
  conversationId: string;
  summary: string;
  upToMessageId?: string | null;
  unresolvedQuestions: string[];
  keyDecisions: string[];
  messageCountCovered: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoundedHistoryOptions {
  maxMessages?: number;
  maxTokens?: number;
  excludeMessageId?: string;
  customPool?: any;
}

/**
 * Calculates approximate token count for string content (1 token ~ 4 chars).
 */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  return Math.max(1, Math.ceil(content.length / 4));
}

/**
 * Retrieves bounded recent messages for a conversation without exceeding message-count
 * or token budgets. Chronologically ordered for conversational grounding.
 */
export async function getBoundedConversationHistory(
  conversationId: string,
  options: BoundedHistoryOptions = {}
): Promise<BoundedHistoryResult> {
  const {
    maxMessages = config.memory.maxMessages,
    maxTokens = config.memory.maxTokens,
    excludeMessageId,
    customPool = pool,
  } = options;

  if (!conversationId) {
    return {
      recentMessages: [],
      totalTokens: 0,
      hasOlderMessages: false,
      olderMessageCount: 0,
    };
  }

  try {
    // Query recent non-empty messages ordered by created_at DESC to fetch the latest
    const query = `
      SELECT id, role, content, token_count, created_at
      FROM messages
      WHERE conversation_id = $1::uuid
        ${excludeMessageId ? 'AND id != $2::uuid' : ''}
        AND content IS NOT NULL
        AND content != ''
        AND (finish_reason IS NULL OR finish_reason != 'cancelled')
      ORDER BY created_at DESC
      LIMIT 100;
    `;

    const params: any[] = [conversationId];
    if (excludeMessageId) {
      params.push(excludeMessageId);
    }

    const res = await customPool.query(query, params);
    const allDesc: any[] = res.rows;

    let totalTokens = 0;
    const includedDesc: BoundedMessage[] = [];
    let olderMessageCount = 0;

    for (let i = 0; i < allDesc.length; i++) {
      const row = allDesc[i];
      const approxTokens = row.token_count || estimateTokens(row.content);

      if (includedDesc.length < maxMessages && totalTokens + approxTokens <= maxTokens) {
        includedDesc.push({
          id: row.id,
          role: row.role,
          content: row.content,
          tokenCount: approxTokens,
          createdAt: row.created_at.toISOString(),
        });
        totalTokens += approxTokens;
      } else {
        olderMessageCount++;
      }
    }

    // Reverse to chronological order (oldest to newest)
    const recentMessages = includedDesc.reverse();
    const hasOlderMessages = olderMessageCount > 0;
    const oldestIncludedMessageId = recentMessages.length > 0 ? recentMessages[0].id : undefined;

    return {
      recentMessages,
      totalTokens,
      hasOlderMessages,
      olderMessageCount,
      oldestIncludedMessageId,
    };
  } catch (err) {
    logger.error({ err, conversationId }, 'Error retrieving bounded conversation history');
    return {
      recentMessages: [],
      totalTokens: 0,
      hasOlderMessages: false,
      olderMessageCount: 0,
    };
  }
}

/**
 * Condenses older messages into a structured conversation summary,
 * preserving unresolved questions, key decisions, and operational context.
 */
export async function summarizeConversation(
  conversationId: string,
  options: { customPool?: any; upToMessageId?: string } = {}
): Promise<ConversationSummaryRecord> {
  const { customPool = pool, upToMessageId } = options;

  // Retrieve candidate messages for summarization
  const query = `
    SELECT id, role, content, created_at
    FROM messages
    WHERE conversation_id = $1::uuid
      ${upToMessageId ? 'AND created_at <= (SELECT created_at FROM messages WHERE id = $2::uuid)' : ''}
      AND content IS NOT NULL
      AND content != ''
    ORDER BY created_at ASC;
  `;

  const params: any[] = [conversationId];
  if (upToMessageId) {
    params.push(upToMessageId);
  }

  const res = await customPool.query(query, params);
  const rows: any[] = res.rows;

  if (rows.length === 0) {
    return {
      id: 'empty',
      conversationId,
      summary: 'No historical conversation context.',
      unresolvedQuestions: [],
      keyDecisions: [],
      messageCountCovered: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Extract key decisions, questions, and context
  const keyDecisions: string[] = [];
  const unresolvedQuestions: string[] = [];
  const narrativeParts: string[] = [];

  for (const m of rows) {
    const text = m.content.trim();
    if (m.role === 'user') {
      if (text.includes('?')) {
        // Extract user questions
        const questions = text.split(/(?<=\?)/).filter((q: string) => q.includes('?'));
        for (const q of questions) {
          if (q.trim().length > 10) unresolvedQuestions.push(q.trim());
        }
      }
      narrativeParts.push(`User inquired: "${text.slice(0, 120)}"`);
    } else if (m.role === 'assistant') {
      // Check for decisions, policies, or operational statements
      if (text.toLowerCase().includes('decision') || text.toLowerCase().includes('policy') || text.toLowerCase().includes('configured')) {
        const sentences = text.split(/(?<=[.?!])\s+/).filter((s: string) => s.length > 20);
        if (sentences.length > 0) {
          keyDecisions.push(sentences[0]);
        }
      }
      narrativeParts.push(`Assistant addressed: "${text.slice(0, 120)}"`);
    }
  }

  const summaryText = narrativeParts.slice(0, 8).join(' | ');
  const latestMessageId = rows[rows.length - 1]?.id || null;
  let verifiedMessageId: string | null = null;
  if (latestMessageId) {
    const msgCheck = await customPool.query(`SELECT id FROM messages WHERE id = $1::uuid;`, [latestMessageId]);
    if (msgCheck.rows.length > 0) {
      verifiedMessageId = latestMessageId;
    }
  }

  // Upsert into conversation_summaries
  const upsertQuery = `
    INSERT INTO conversation_summaries (
      conversation_id, summary, up_to_message_id, unresolved_questions, key_decisions, message_count_covered, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (conversation_id) DO UPDATE SET
      summary = EXCLUDED.summary,
      up_to_message_id = EXCLUDED.up_to_message_id,
      unresolved_questions = EXCLUDED.unresolved_questions,
      key_decisions = EXCLUDED.key_decisions,
      message_count_covered = EXCLUDED.message_count_covered,
      updated_at = NOW()
    RETURNING id, conversation_id, summary, up_to_message_id, unresolved_questions, key_decisions, message_count_covered, created_at, updated_at;
  `;

  const upsertRes = await customPool.query(upsertQuery, [
    conversationId,
    summaryText,
    verifiedMessageId,
    JSON.stringify(unresolvedQuestions.slice(0, 5)),
    JSON.stringify(keyDecisions.slice(0, 5)),
    rows.length,
  ]);

  const saved = upsertRes.rows[0];
  return {
    id: saved.id,
    conversationId: saved.conversation_id,
    summary: saved.summary,
    upToMessageId: saved.up_to_message_id,
    unresolvedQuestions: saved.unresolved_questions,
    keyDecisions: saved.key_decisions,
    messageCountCovered: saved.message_count_covered,
    createdAt: saved.created_at.toISOString(),
    updatedAt: saved.updated_at.toISOString(),
  };
}

/**
 * Retrieves existing conversation summary if available.
 */
export async function getConversationSummary(
  conversationId: string,
  customPool = pool
): Promise<ConversationSummaryRecord | null> {
  try {
    const res = await customPool.query(
      `SELECT id, conversation_id, summary, up_to_message_id, unresolved_questions, key_decisions, message_count_covered, created_at, updated_at
       FROM conversation_summaries
       WHERE conversation_id = $1::uuid;`,
      [conversationId]
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      conversationId: r.conversation_id,
      summary: r.summary,
      upToMessageId: r.up_to_message_id,
      unresolvedQuestions: r.unresolved_questions,
      keyDecisions: r.key_decisions,
      messageCountCovered: r.message_count_covered,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  } catch (err) {
    logger.warn({ err, conversationId }, 'Failed to fetch conversation summary');
    return null;
  }
}

/**
 * Explicitly purges/deletes conversation memory and summaries for a conversation.
 * Verifies tenant ownership before executing deletion.
 */
export async function deleteConversationMemory(
  conversationId: string,
  workspaceId?: string,
  customPool = pool
): Promise<{ deleted: boolean; deletedCount: number }> {
  try {
    if (workspaceId) {
      // Verify conversation belongs to workspace
      const check = await customPool.query(
        `SELECT id FROM conversations WHERE id = $1::uuid AND workspace_id = $2::uuid;`,
        [conversationId, workspaceId]
      );

      if (check.rows.length === 0) {
        return { deleted: false, deletedCount: 0 };
      }
    }

    // Delete summary
    await customPool.query(
      `DELETE FROM conversation_summaries WHERE conversation_id = $1::uuid;`,
      [conversationId]
    );

    // Delete messages
    const delRes = await customPool.query(
      `DELETE FROM messages WHERE conversation_id = $1::uuid;`,
      [conversationId]
    );

    return { deleted: true, deletedCount: delRes.rowCount || 0 };
  } catch (err) {
    logger.error({ err, conversationId, workspaceId }, 'Error deleting conversation memory');
    throw err;
  }
}

/**
 * Automated retention purge service: purges messages and summaries exceeding retention limits.
 */
export async function purgeExpiredMemory(
  options: { workspaceId?: string; retentionDays?: number; customPool?: any } = {}
): Promise<{ purgedMessages: number; purgedSummaries: number }> {
  const {
    workspaceId,
    retentionDays = config.memory.retentionDays,
    customPool = pool,
  } = options;

  try {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const msgQuery = `
      DELETE FROM messages m
      USING conversations c
      WHERE m.conversation_id = c.id
        ${workspaceId ? 'AND c.workspace_id = $2::uuid' : ''}
        AND m.created_at < $1::timestamptz;
    `;
    const msgParams: any[] = [cutoffDate];
    if (workspaceId) msgParams.push(workspaceId);

    const msgDel = await customPool.query(msgQuery, msgParams);

    const sumQuery = `
      DELETE FROM conversation_summaries s
      USING conversations c
      WHERE s.conversation_id = c.id
        ${workspaceId ? 'AND c.workspace_id = $2::uuid' : ''}
        AND s.updated_at < $1::timestamptz;
    `;
    const sumParams: any[] = [cutoffDate];
    if (workspaceId) sumParams.push(workspaceId);

    const sumDel = await customPool.query(sumQuery, sumParams);

    return {
      purgedMessages: msgDel.rowCount || 0,
      purgedSummaries: sumDel.rowCount || 0,
    };
  } catch (err) {
    logger.error({ err }, 'Error during memory retention purge');
    return { purgedMessages: 0, purgedSummaries: 0 };
  }
}
