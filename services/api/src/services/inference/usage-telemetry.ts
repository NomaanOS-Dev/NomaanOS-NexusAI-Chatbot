/**
 * NomaanOS Nexus AI - Inference Usage & Failure Telemetry Service (Day 17)
 *
 * Records token consumption, inference latency, cost estimates, rate limits, and failure events
 * to PostgreSQL and provides real-time in-memory observability metrics.
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../config/logger.js';
import {
  InferenceUsageRecord,
  InferenceFailureRecord,
  InferenceMetricsSummary,
} from './types.js';

export interface RecordUsageInput {
  workspaceId?: string;
  assistantId?: string;
  conversationId?: string;
  provider: string;
  model: string;
  routingPolicy: string;
  taskComplexity: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
  status: 'success' | 'fallback' | 'failed' | 'rate_limited';
  fallbackProvider?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordFailureInput {
  workspaceId?: string;
  provider: string;
  model: string;
  errorCode: string;
  statusCode?: number;
  errorMessage: string;
  routingPolicy: string;
  fallbackTriggered: boolean;
  fallbackProvider?: string;
}

export class UsageTelemetryService {
  private static instance: UsageTelemetryService | null = null;

  // In-memory counters for real-time reporting
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private fallbackRequests = 0;
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private totalTokens = 0;
  private totalEstimatedCostUsd = 0;
  private totalDurationMs = 0;

  private providerBreakdown = new Map<
    string,
    { requests: number; failures: number; tokens: number; costUsd: number }
  >();

  private policyBreakdown = new Map<
    string,
    { requests: number; fallbacks: number }
  >();

  static getInstance(): UsageTelemetryService {
    if (!UsageTelemetryService.instance) {
      UsageTelemetryService.instance = new UsageTelemetryService();
    }
    return UsageTelemetryService.instance;
  }

  static resetInstance(): void {
    UsageTelemetryService.instance = null;
  }

  /**
   * Records a completed inference generation event (success or fallback).
   */
  async recordUsage(input: RecordUsageInput): Promise<void> {
    // 1. Update in-memory metrics
    this.totalRequests++;
    if (input.status === 'success') {
      this.successfulRequests++;
    } else if (input.status === 'fallback') {
      this.successfulRequests++;
      this.fallbackRequests++;
    } else {
      this.failedRequests++;
    }

    this.totalPromptTokens += input.promptTokens;
    this.totalCompletionTokens += input.completionTokens;
    this.totalTokens += input.totalTokens;
    this.totalEstimatedCostUsd += input.estimatedCostUsd;
    this.totalDurationMs += input.durationMs;

    // Provider stats
    const pStats = this.providerBreakdown.get(input.provider) || {
      requests: 0,
      failures: 0,
      tokens: 0,
      costUsd: 0,
    };
    pStats.requests++;
    pStats.tokens += input.totalTokens;
    pStats.costUsd += input.estimatedCostUsd;
    this.providerBreakdown.set(input.provider, pStats);

    // Policy stats
    const polStats = this.policyBreakdown.get(input.routingPolicy) || {
      requests: 0,
      fallbacks: 0,
    };
    polStats.requests++;
    if (input.fallbackProvider) {
      polStats.fallbacks++;
    }
    this.policyBreakdown.set(input.routingPolicy, polStats);

    // 2. Persist to PostgreSQL asynchronously
    try {
      await pool.query(
        `INSERT INTO inference_usage_records (
           workspace_id, assistant_id, conversation_id, provider, model,
           routing_policy, task_complexity, prompt_tokens, completion_tokens,
           total_tokens, duration_ms, estimated_cost_usd, status, fallback_provider, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);`,
        [
          input.workspaceId || null,
          input.assistantId || null,
          input.conversationId || null,
          input.provider,
          input.model,
          input.routingPolicy,
          input.taskComplexity,
          input.promptTokens,
          input.completionTokens,
          input.totalTokens,
          input.durationMs,
          input.estimatedCostUsd,
          input.status,
          input.fallbackProvider || null,
          JSON.stringify(input.metadata || {}),
        ]
      );
    } catch (err: any) {
      logger.warn({ err: err.message, provider: input.provider }, 'Failed to persist inference usage record to DB');
    }
  }

  /**
   * Records an inference failure event.
   */
  async recordFailure(input: RecordFailureInput): Promise<void> {
    this.failedRequests++;

    const pStats = this.providerBreakdown.get(input.provider) || {
      requests: 0,
      failures: 0,
      tokens: 0,
      costUsd: 0,
    };
    pStats.failures++;
    this.providerBreakdown.set(input.provider, pStats);

    if (input.fallbackTriggered) {
      this.fallbackRequests++;
      const polStats = this.policyBreakdown.get(input.routingPolicy) || {
        requests: 0,
        fallbacks: 0,
      };
      polStats.fallbacks++;
      this.policyBreakdown.set(input.routingPolicy, polStats);
    }

    try {
      await pool.query(
        `INSERT INTO inference_failures (
           workspace_id, provider, model, error_code, status_code,
           error_message, routing_policy, fallback_triggered, fallback_provider
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
        [
          input.workspaceId || null,
          input.provider,
          input.model,
          input.errorCode,
          input.statusCode || null,
          input.errorMessage,
          input.routingPolicy,
          input.fallbackTriggered,
          input.fallbackProvider || null,
        ]
      );
    } catch (err: any) {
      logger.warn({ err: err.message, provider: input.provider }, 'Failed to persist inference failure record to DB');
    }
  }

  /**
   * Retrieves summary metrics across all requests or filtered by workspace.
   */
  async getMetricsSummary(workspaceId?: string): Promise<InferenceMetricsSummary> {
    if (workspaceId) {
      try {
        const usageRes = await pool.query(
          `SELECT 
             COUNT(*)::int AS total_requests,
             COUNT(*) FILTER (WHERE status = 'success')::int AS successful_requests,
             COUNT(*) FILTER (WHERE status = 'fallback')::int AS fallback_requests,
             COALESCE(SUM(prompt_tokens), 0)::int AS total_prompt_tokens,
             COALESCE(SUM(completion_tokens), 0)::int AS total_completion_tokens,
             COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
             COALESCE(SUM(estimated_cost_usd), 0)::numeric AS total_cost_usd,
             COALESCE(AVG(duration_ms), 0)::int AS avg_duration_ms
           FROM inference_usage_records
           WHERE workspace_id = $1;`,
          [workspaceId]
        );

        const failRes = await pool.query(
          `SELECT COUNT(*)::int AS total_failures FROM inference_failures WHERE workspace_id = $1;`,
          [workspaceId]
        );

        const row = usageRes.rows[0];
        const failures = failRes.rows[0]?.total_failures || 0;

        return {
          totalRequests: row.total_requests,
          successfulRequests: row.successful_requests + row.fallback_requests,
          failedRequests: failures,
          fallbackRequests: row.fallback_requests,
          totalPromptTokens: row.total_prompt_tokens,
          totalCompletionTokens: row.total_completion_tokens,
          totalTokens: row.total_tokens,
          totalEstimatedCostUsd: parseFloat(row.total_cost_usd || '0'),
          averageDurationMs: row.avg_duration_ms,
          providerBreakdown: Object.fromEntries(this.providerBreakdown.entries()),
          policyBreakdown: Object.fromEntries(this.policyBreakdown.entries()),
        };
      } catch (err: any) {
        logger.warn({ err: err.message, workspaceId }, 'Error retrieving DB metrics; returning in-memory snapshot');
      }
    }

    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      fallbackRequests: this.fallbackRequests,
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      totalTokens: this.totalTokens,
      totalEstimatedCostUsd: Number(this.totalEstimatedCostUsd.toFixed(6)),
      averageDurationMs: this.totalRequests > 0 ? Math.round(this.totalDurationMs / this.totalRequests) : 0,
      providerBreakdown: Object.fromEntries(this.providerBreakdown.entries()),
      policyBreakdown: Object.fromEntries(this.policyBreakdown.entries()),
    };
  }
}

