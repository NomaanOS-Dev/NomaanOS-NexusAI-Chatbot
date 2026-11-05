/**
 * NomaanOS Nexus AI - Intelligent Model Routing Service (Day 17)
 *
 * Implements policy-based model routing across Local, Cloud-Preferred, Hybrid, and Cloud-Only modes.
 * Features:
 * - Policy validation and strict zero-leakage enforcement for Local-Only mode
 * - Task-complexity based routing under Hybrid policy
 * - Rate-limit detection, cooldown tracking, and automatic fallback
 * - Comprehensive usage and failure telemetry
 */

import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type {
  GenerationRequest,
  GenerationResponse,
  ModelRoutingPolicy,
  ModelRoutingResult,
  RoutingDecision,
} from './types.js';
import { ProviderRegistry } from './provider-registry.js';
import { evaluateTaskComplexity } from './task-complexity.js';
import { UsageTelemetryService } from './usage-telemetry.js';
import {
  PolicyViolationError,
  RateLimitError,
  CredentialsMissingError,
  InferenceError,
} from './errors.js';

export interface ModelRouterOptions {
  registry?: ProviderRegistry;
  telemetry?: UsageTelemetryService;
}

export class ModelRouter {
  private readonly registry: ProviderRegistry;
  private readonly telemetry: UsageTelemetryService;

  constructor(options: ModelRouterOptions = {}) {
    this.registry = options.registry || ProviderRegistry.getInstance();
    this.telemetry = options.telemetry || UsageTelemetryService.getInstance();
  }

  /**
   * Resolves routing decision based on policy, task complexity, credentials, and provider health.
   */
  async decideRoute(request: GenerationRequest): Promise<RoutingDecision> {
    const rawPolicy = (
      request.routingPolicy ||
      config.inference.routingPolicy ||
      'local-only'
    ).toLowerCase();

    // Normalize policy name (e.g. 'local_only' -> 'local-only')
    const policy = (rawPolicy.replace('_', '-') as ModelRoutingPolicy);

    // Evaluate task complexity
    const complexityAnalysis = evaluateTaskComplexity(request);
    const complexity = complexityAnalysis.complexity;

    const effectivePolicy = policy;

    // 1. Policy: Local-Only
    if (effectivePolicy === 'local-only') {
      if (request.forceProvider && ['openai', 'anthropic', 'cloud'].includes(request.forceProvider.toLowerCase())) {
        throw new PolicyViolationError(
          'local-only',
          `Cloud inference provider '${request.forceProvider}' is strictly disabled because LOCAL_INFERENCE_ONLY is active.`
        );
      }

      const localTarget =
        request.forceProvider && ['local_deterministic', 'deterministic', 'mock'].includes(request.forceProvider.toLowerCase())
          ? 'local_deterministic'
          : 'ollama';

      return {
        targetProvider: localTarget,
        targetModel: request.model || (localTarget === 'ollama' ? config.inference.ollamaModel : 'nexus-deterministic-v1'),
        policy: 'local-only',
        taskComplexity: complexity,
        reason: 'Local-only policy active: all cloud routes are blocked.',
        fallbackProvider: localTarget === 'ollama' ? 'local_deterministic' : undefined,
        fallbackModel: 'nexus-deterministic-v1',
        isCloud: false,
      };
    }

    // 2. Policy: Cloud-Only
    if (effectivePolicy === 'cloud-only') {
      const cloudProvider = (request.forceProvider || 'openai').toLowerCase();
      const targetModel =
        request.model ||
        (cloudProvider === 'anthropic' ? config.inference.anthropic.model : config.inference.openai.model);

      return {
        targetProvider: cloudProvider,
        targetModel,
        policy: 'cloud-only',
        taskComplexity: complexity,
        reason: 'Cloud-only policy active: local execution is disabled.',
        fallbackProvider: undefined, // Cloud-only strictly NEVER falls back to local
        fallbackModel: undefined,
        isCloud: true,
      };
    }

    // 3. Policy: Cloud-Preferred
    if (effectivePolicy === 'cloud-preferred') {
      const preferredCloud = (request.forceProvider || 'openai').toLowerCase();
      const targetModel =
        request.model ||
        (preferredCloud === 'anthropic' ? config.inference.anthropic.model : config.inference.openai.model);

      return {
        targetProvider: preferredCloud,
        targetModel,
        policy: 'cloud-preferred',
        taskComplexity: complexity,
        reason: 'Cloud-preferred policy: utilizing cloud inference with local offline fallback.',
        fallbackProvider: 'ollama',
        fallbackModel: config.inference.ollamaModel,
        isCloud: true,
      };
    }

    // 4. Policy: Hybrid
    if (effectivePolicy === 'hybrid') {
      // Sensitive data constraint always forces local inference
      if (request.containsSensitiveData) {
        return {
          targetProvider: 'ollama',
          targetModel: config.inference.ollamaModel,
          policy: 'hybrid',
          taskComplexity: complexity,
          reason: 'Hybrid policy: sensitive data flag active; routed to local inference for zero exposure.',
          fallbackProvider: 'local_deterministic',
          fallbackModel: 'nexus-deterministic-v1',
          isCloud: false,
        };
      }

      // Complex tasks route to cloud model; simple/standard route to local model
      if (complexity === 'complex') {
        const cloudProvider = (request.forceProvider || 'openai').toLowerCase();
        const targetModel =
          request.model ||
          (cloudProvider === 'anthropic' ? config.inference.anthropic.model : config.inference.openai.model);

        return {
          targetProvider: cloudProvider,
          targetModel,
          policy: 'hybrid',
          taskComplexity: complexity,
          reason: `Hybrid policy: complex task (${complexityAnalysis.reason}); routed to high-capacity cloud model.`,
          fallbackProvider: 'ollama',
          fallbackModel: config.inference.ollamaModel,
          isCloud: true,
        };
      }

      // Simple or standard complexity -> route locally for low latency and zero cost
      return {
        targetProvider: 'ollama',
        targetModel: request.model || config.inference.ollamaModel,
        policy: 'hybrid',
        taskComplexity: complexity,
        reason: `Hybrid policy: ${complexity} task; routed to local model for low latency and zero API cost.`,
        fallbackProvider: 'local_deterministic',
        fallbackModel: 'nexus-deterministic-v1',
        isCloud: false,
      };
    }

    throw new PolicyViolationError(rawPolicy, `Unrecognized model routing policy: "${rawPolicy}"`);
  }

  /**
   * Executes inference routing generation according to policy.
   */
  async route(request: GenerationRequest): Promise<ModelRoutingResult> {
    const decision = await this.decideRoute(request);
    let targetProviderName = decision.targetProvider;
    let targetModelName = decision.targetModel;

    // Check if target provider is currently rate-limited
    if (this.registry.isRateLimited(targetProviderName)) {
      const resetTime = this.registry.getRateLimitReset(targetProviderName);
      logger.warn(
        { provider: targetProviderName, resetAt: resetTime?.toISOString() },
        'Target provider is currently rate-limited'
      );

      // If fallback allowed by policy, switch to fallback
      if (decision.fallbackProvider) {
        return await this.executeFallback(
          request,
          decision,
          `Provider '${targetProviderName}' is rate-limited until ${resetTime?.toISOString()}`
        );
      }

      throw new RateLimitError(
        targetProviderName,
        resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 30,
        `Provider '${targetProviderName}' is currently rate-limited and policy forbids fallback.`
      );
    }

    // Attempt primary provider generation
    try {
      const provider = await this.registry.getProvider(targetProviderName, request.workspaceId, {
        model: targetModelName,
      });

      const response = await this.executeWithRetry(() =>
        provider.generate({
          ...request,
          model: targetModelName,
        })
      );

      // Record successful usage
      await this.telemetry.recordUsage({
        workspaceId: request.workspaceId,
        assistantId: request.assistantId,
        conversationId: request.conversationId,
        provider: provider.name,
        model: response.model,
        routingPolicy: decision.policy,
        taskComplexity: decision.taskComplexity,
        promptTokens: response.promptTokens || 0,
        completionTokens: response.completionTokens || 0,
        totalTokens: response.totalTokens || 0,
        durationMs: response.durationMs || 0,
        estimatedCostUsd: response.estimatedCostUsd || 0,
        status: 'success',
      });

      return {
        ...response,
        routingDecision: decision,
        fallbackTriggered: false,
      };
    } catch (err: any) {
      return await this.handlePrimaryFailure(err, request, decision);
    }
  }

  /**
   * Executes streaming generation according to policy.
   */
  async routeStream(
    request: GenerationRequest,
    onChunk: (delta: string) => void
  ): Promise<ModelRoutingResult> {
    const decision = await this.decideRoute(request);
    let targetProviderName = decision.targetProvider;
    let targetModelName = decision.targetModel;

    if (this.registry.isRateLimited(targetProviderName)) {
      if (decision.fallbackProvider) {
        return await this.executeFallbackStream(
          request,
          decision,
          onChunk,
          `Provider '${targetProviderName}' is currently rate-limited.`
        );
      }
      throw new RateLimitError(targetProviderName, 30);
    }

    try {
      const provider = await this.registry.getProvider(targetProviderName, request.workspaceId, {
        model: targetModelName,
      });

      const response = await provider.generateStream(
        {
          ...request,
          model: targetModelName,
        },
        onChunk
      );

      await this.telemetry.recordUsage({
        workspaceId: request.workspaceId,
        assistantId: request.assistantId,
        conversationId: request.conversationId,
        provider: provider.name,
        model: response.model,
        routingPolicy: decision.policy,
        taskComplexity: decision.taskComplexity,
        promptTokens: response.promptTokens || 0,
        completionTokens: response.completionTokens || 0,
        totalTokens: response.totalTokens || 0,
        durationMs: response.durationMs || 0,
        estimatedCostUsd: response.estimatedCostUsd || 0,
        status: 'success',
      });

      return {
        ...response,
        routingDecision: decision,
        fallbackTriggered: false,
      };
    } catch (err: any) {
      if (decision.fallbackProvider) {
        return await this.executeFallbackStream(request, decision, onChunk, err.message);
      }
      throw err;
    }
  }

  /**
   * Handles primary provider failure and triggers fallback if permitted by policy.
   */
  private async handlePrimaryFailure(
    err: any,
    request: GenerationRequest,
    decision: RoutingDecision
  ): Promise<ModelRoutingResult> {
    const primaryProvider = decision.targetProvider;

    // Detect rate limit and mark provider
    if (err instanceof RateLimitError || err.statusCode === 429) {
      const retryAfter = err instanceof RateLimitError ? err.retryAfterSeconds : 30;
      this.registry.markRateLimited(primaryProvider, retryAfter);
    }

    // Log failure in telemetry
    await this.telemetry.recordFailure({
      workspaceId: request.workspaceId,
      provider: primaryProvider,
      model: decision.targetModel,
      errorCode: err.name || 'InferenceError',
      statusCode: err.statusCode || 500,
      errorMessage: err.message,
      routingPolicy: decision.policy,
      fallbackTriggered: Boolean(decision.fallbackProvider),
      fallbackProvider: decision.fallbackProvider,
    });

    // Check if fallback is permitted
    if (!decision.fallbackProvider) {
      // Local-only never falls back to cloud; Cloud-only never falls back to local
      logger.error(
        { provider: primaryProvider, policy: decision.policy, err: err.message },
        'Primary inference failed and policy strictly forbids fallback'
      );
      throw err;
    }

    return await this.executeFallback(request, decision, err.message);
  }

  /**
   * Executes fallback provider generation.
   */
  private async executeFallback(
    request: GenerationRequest,
    decision: RoutingDecision,
    reason: string
  ): Promise<ModelRoutingResult> {
    const fallbackName = decision.fallbackProvider!;
    logger.warn(
      { primary: decision.targetProvider, fallback: fallbackName, reason, policy: decision.policy },
      'Executing inference fallback'
    );

    try {
      const fallbackProvider = await this.registry.getProvider(fallbackName, request.workspaceId, {
        model: decision.fallbackModel,
      });

      const response = await fallbackProvider.generate({
        ...request,
        model: decision.fallbackModel,
      });

      await this.telemetry.recordUsage({
        workspaceId: request.workspaceId,
        assistantId: request.assistantId,
        conversationId: request.conversationId,
        provider: fallbackProvider.name,
        model: response.model,
        routingPolicy: decision.policy,
        taskComplexity: decision.taskComplexity,
        promptTokens: response.promptTokens || 0,
        completionTokens: response.completionTokens || 0,
        totalTokens: response.totalTokens || 0,
        durationMs: response.durationMs || 0,
        estimatedCostUsd: response.estimatedCostUsd || 0,
        status: 'fallback',
        fallbackProvider: fallbackName,
      });

      return {
        ...response,
        provider: response.provider || fallbackProvider.name,
        routingDecision: decision,
        fallbackTriggered: true,
        fallbackReason: reason,
        primaryError: reason,
      };
    } catch (fallbackErr: any) {
      // Secondary fallback to deterministic if ollama also fails
      if (fallbackName === 'ollama') {
        logger.warn('Ollama fallback failed; engaging secondary deterministic local synthesis');
        const deterministicProvider = await this.registry.getProvider('local_deterministic');
        const response = await deterministicProvider.generate(request);
        return {
          ...response,
          provider: response.provider || deterministicProvider.name,
          routingDecision: decision,
          fallbackTriggered: true,
          fallbackReason: `Ollama fallback failed: ${fallbackErr.message}`,
        };
      }
      throw fallbackErr;
    }
  }

  /**
   * Executes fallback streaming generation.
   */
  private async executeFallbackStream(
    request: GenerationRequest,
    decision: RoutingDecision,
    onChunk: (delta: string) => void,
    reason: string
  ): Promise<ModelRoutingResult> {
    const fallbackName = decision.fallbackProvider!;
    const fallbackProvider = await this.registry.getProvider(fallbackName, request.workspaceId, {
      model: decision.fallbackModel,
    });

    const response = await fallbackProvider.generateStream(
      {
        ...request,
        model: decision.fallbackModel,
      },
      onChunk
    );

    return {
      ...response,
      routingDecision: decision,
      fallbackTriggered: true,
      fallbackReason: reason,
    };
  }

  /**
   * Executes an operation with exponential backoff for transient retryable errors.
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = config.inference.rateLimit.retryAttempts;
    const baseDelay = config.inference.rateLimit.baseDelayMs;

    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (err: any) {
        attempt++;
        const isRetryable = err.isRetryable || err.statusCode === 502 || err.statusCode === 503 || err.statusCode === 504;

        if (attempt > maxAttempts || !isRetryable) {
          throw err;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.info({ attempt, maxAttempts, delay, err: err.message }, 'Retrying inference call after transient failure');
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
}

