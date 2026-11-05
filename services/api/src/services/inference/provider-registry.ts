/**
 * NomaanOS Nexus AI - Provider Capability Registry (Day 17)
 *
 * Manages provider registration, rate-limit state tracking, workspace credential resolution,
 * and unified capability discovery across local and cloud engines.
 */

import { pool } from '../../database/pool.js';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { decryptSecret, maskApiKey } from '../tokens.js';
import {
  InferenceProvider,
  ProviderHealthResponse,
  InferenceModelInfo,
  ModelCapabilityInfo,
} from './types.js';
import { OllamaInferenceProvider } from './ollama-provider.js';
import { DeterministicLocalProvider } from './deterministic-provider.js';
import { OpenAIInferenceProvider } from './openai-provider.js';
import { AnthropicInferenceProvider } from './anthropic-provider.js';

export interface RateLimitState {
  provider: string;
  isLimited: boolean;
  limitedAt: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null;
  private readonly rateLimits = new Map<string, RateLimitState>();
  private customProviders = new Map<string, InferenceProvider>();

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  /**
   * Resets singleton (useful in unit test suites).
   */
  static resetInstance(): void {
    ProviderRegistry.instance = null;
  }

  /**
   * Registers or overrides a custom provider instance (e.g. mock in tests).
   */
  registerProvider(name: string, provider: InferenceProvider): void {
    this.customProviders.set(name.toLowerCase(), provider);
  }

  /**
   * Removes a custom provider instance.
   */
  unregisterProvider(name: string): void {
    this.customProviders.delete(name.toLowerCase());
  }

  /**
   * Resolves an inference provider instance with dynamic workspace credential resolution.
   */
  async getProvider(
    providerName: string,
    workspaceId?: string,
    overrides?: { model?: string; baseUrl?: string; timeoutMs?: number; apiKey?: string }
  ): Promise<InferenceProvider> {
    const key = providerName.toLowerCase();

    // Custom injected provider (e.g. in test mock)
    if (this.customProviders.has(key)) {
      return this.customProviders.get(key)!;
    }

    if (key === 'local_deterministic' || key === 'deterministic' || key === 'mock') {
      return new DeterministicLocalProvider(overrides?.model || 'nexus-deterministic-v1');
    }

    if (key === 'ollama') {
      return new OllamaInferenceProvider({
        baseUrl: overrides?.baseUrl || config.inference.ollamaBaseUrl,
        defaultModel: overrides?.model || config.inference.ollamaModel,
        timeoutMs: overrides?.timeoutMs || config.inference.ollamaTimeoutMs,
        keepAlive: config.inference.ollamaKeepAlive,
        temperature: config.inference.ollamaTemperature,
      });
    }

    if (key === 'openai') {
      let apiKey = overrides?.apiKey || config.inference.openai.apiKey || process.env.OPENAI_API_KEY;

      if (!apiKey && workspaceId) {
        apiKey = await this.resolveWorkspaceCredential(workspaceId, 'openai');
      }

      return new OpenAIInferenceProvider({
        apiKey,
        baseUrl: overrides?.baseUrl || config.inference.openai.baseUrl,
        defaultModel: overrides?.model || config.inference.openai.model,
        timeoutMs: overrides?.timeoutMs || config.inference.openai.timeoutMs,
      });
    }

    if (key === 'anthropic') {
      let apiKey = overrides?.apiKey || config.inference.anthropic.apiKey || process.env.ANTHROPIC_API_KEY;

      if (!apiKey && workspaceId) {
        apiKey = await this.resolveWorkspaceCredential(workspaceId, 'anthropic');
      }

      return new AnthropicInferenceProvider({
        apiKey,
        baseUrl: overrides?.baseUrl || config.inference.anthropic.baseUrl,
        defaultModel: overrides?.model || config.inference.anthropic.model,
        timeoutMs: overrides?.timeoutMs || config.inference.anthropic.timeoutMs,
      });
    }

    throw new Error(`Unknown inference provider: "${providerName}". Supported: 'ollama', 'local_deterministic', 'openai', 'anthropic'`);
  }

  /**
   * Resolves encrypted provider credential for a workspace from DB.
   */
  async resolveWorkspaceCredential(workspaceId: string, provider: string): Promise<string | undefined> {
    try {
      const res = await pool.query(
        `SELECT encrypted_api_key FROM provider_credentials 
         WHERE workspace_id = $1 AND provider = $2 AND status = 'active'
         LIMIT 1;`,
        [workspaceId, provider.toLowerCase()]
      );

      if (res.rows.length > 0 && res.rows[0].encrypted_api_key) {
        return decryptSecret(res.rows[0].encrypted_api_key);
      }
    } catch (err: any) {
      logger.warn({ workspaceId, provider, err: err.message }, 'Failed to resolve workspace provider credential');
    }
    return undefined;
  }

  /**
   * Marks a provider as rate-limited with an active reset cooldown.
   */
  markRateLimited(provider: string, retryAfterSeconds = 30): void {
    const p = provider.toLowerCase();
    const now = Date.now();
    const resetAt = now + retryAfterSeconds * 1000;

    this.rateLimits.set(p, {
      provider: p,
      isLimited: true,
      limitedAt: now,
      resetAt,
      retryAfterSeconds,
    });

    logger.warn({ provider: p, retryAfterSeconds, resetAt: new Date(resetAt).toISOString() }, 'Provider marked rate limited');
  }

  /**
   * Checks whether a provider is currently rate-limited.
   */
  isRateLimited(provider: string): boolean {
    const p = provider.toLowerCase();
    const state = this.rateLimits.get(p);
    if (!state) return false;

    if (Date.now() >= state.resetAt) {
      this.rateLimits.delete(p);
      return false;
    }
    return true;
  }

  /**
   * Returns rate-limit reset timestamp if currently limited.
   */
  getRateLimitReset(provider: string): Date | null {
    const p = provider.toLowerCase();
    const state = this.rateLimits.get(p);
    if (!state) return null;

    if (Date.now() >= state.resetAt) {
      this.rateLimits.delete(p);
      return null;
    }
    return new Date(state.resetAt);
  }

  /**
   * Manually clears the rate limit on a provider.
   */
  clearRateLimit(provider: string): void {
    this.rateLimits.delete(provider.toLowerCase());
  }

  /**
   * Checks health across all registered providers.
   */
  async checkAllHealth(workspaceId?: string): Promise<ProviderHealthResponse[]> {
    const providerNames = ['ollama', 'local_deterministic', 'openai', 'anthropic'];
    const results: ProviderHealthResponse[] = [];

    for (const name of providerNames) {
      try {
        const provider = await this.getProvider(name, workspaceId);
        const health = await provider.checkHealth();
        if (this.isRateLimited(name)) {
          health.status = 'rate_limited';
          health.rateLimited = true;
          health.rateLimitResetAt = this.getRateLimitReset(name)?.toISOString();
        }
        results.push(health);
      } catch (err: any) {
        results.push({
          provider: name,
          status: 'unavailable',
          baseUrl: '',
          currentModel: '',
          availableModels: [],
          capabilities: { streaming: false, jsonMode: false, contextLength: 0 },
          isCloud: name === 'openai' || name === 'anthropic',
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Returns models from all providers permitted by the active local-only policy.
   */
  async listAllModels(workspaceId?: string): Promise<InferenceModelInfo[]> {
    const providerNames = config.inference.localOnly
      ? ['ollama', 'local_deterministic']
      : ['ollama', 'local_deterministic', 'openai', 'anthropic'];

    const allModels: InferenceModelInfo[] = [];

    for (const name of providerNames) {
      try {
        const provider = await this.getProvider(name, workspaceId);
        const models = await provider.listModels();
        allModels.push(...models);
      } catch {
        // Skip unavailable provider models
      }
    }

    return allModels;
  }
}

