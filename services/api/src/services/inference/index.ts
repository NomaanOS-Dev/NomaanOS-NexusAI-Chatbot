/**
 * NomaanOS Nexus AI - Inference Service Manager & Factory (Day 16 & Day 17)
 *
 * Manages provider registration, local-only inference policy enforcement,
 * dynamic resolution of Ollama, Cloud (OpenAI, Anthropic), and ModelRouter.
 */

import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { InferenceProvider, ProviderHealthResponse, GenerationRequest, GenerationResponse, ModelRoutingResult } from './types.js';
import { OllamaInferenceProvider } from './ollama-provider.js';
import { DeterministicLocalProvider } from './deterministic-provider.js';
import { OpenAIInferenceProvider } from './openai-provider.js';
import { AnthropicInferenceProvider } from './anthropic-provider.js';
import { ProviderRegistry } from './provider-registry.js';
import { ModelRouter } from './model-router.js';
import { UsageTelemetryService } from './usage-telemetry.js';

export * from './types.js';
export * from './errors.js';
export * from './ollama-provider.js';
export * from './deterministic-provider.js';
export * from './openai-provider.js';
export * from './anthropic-provider.js';
export * from './provider-registry.js';
export * from './task-complexity.js';
export * from './usage-telemetry.js';
export * from './model-router.js';

let defaultProviderInstance: InferenceProvider | null = null;
let defaultRouterInstance: ModelRouter | null = null;

/**
 * Returns an instance of the ModelRouter.
 */
export function getModelRouter(): ModelRouter {
  if (!defaultRouterInstance) {
    defaultRouterInstance = new ModelRouter();
  }
  return defaultRouterInstance;
}

/**
 * Returns an instance of the configured inference provider.
 */
export function getInferenceProvider(
  providerName?: string,
  overrides?: { baseUrl?: string; model?: string; timeoutMs?: number; apiKey?: string }
): InferenceProvider {
  const chosen = (providerName || config.inference.provider || 'ollama').toLowerCase();

  if (chosen === 'local_deterministic' || chosen === 'deterministic' || chosen === 'mock') {
    return new DeterministicLocalProvider(overrides?.model || 'nexus-deterministic-v1');
  }

  // Ollama Provider
  if (chosen === 'ollama') {
    if (overrides) {
      return new OllamaInferenceProvider({
        baseUrl: overrides.baseUrl || config.inference.ollamaBaseUrl,
        defaultModel: overrides.model || config.inference.ollamaModel,
        timeoutMs: overrides.timeoutMs || config.inference.ollamaTimeoutMs,
        keepAlive: config.inference.ollamaKeepAlive,
        temperature: config.inference.ollamaTemperature,
      });
    }

    if (!defaultProviderInstance || defaultProviderInstance.name !== 'ollama') {
      defaultProviderInstance = new OllamaInferenceProvider({
        baseUrl: config.inference.ollamaBaseUrl,
        defaultModel: config.inference.ollamaModel,
        timeoutMs: config.inference.ollamaTimeoutMs,
        keepAlive: config.inference.ollamaKeepAlive,
        temperature: config.inference.ollamaTemperature,
      });
    }
    return defaultProviderInstance;
  }

  // OpenAI Provider
  if (chosen === 'openai') {
    return new OpenAIInferenceProvider({
      apiKey: overrides?.apiKey || config.inference.openai.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: overrides?.baseUrl || config.inference.openai.baseUrl,
      defaultModel: overrides?.model || config.inference.openai.model,
      timeoutMs: overrides?.timeoutMs || config.inference.openai.timeoutMs,
    });
  }

  // Anthropic Provider
  if (chosen === 'anthropic') {
    return new AnthropicInferenceProvider({
      apiKey: overrides?.apiKey || config.inference.anthropic.apiKey || process.env.ANTHROPIC_API_KEY,
      baseUrl: overrides?.baseUrl || config.inference.anthropic.baseUrl,
      defaultModel: overrides?.model || config.inference.anthropic.model,
      timeoutMs: overrides?.timeoutMs || config.inference.anthropic.timeoutMs,
    });
  }

  throw new Error(`Unsupported inference provider: "${chosen}". Supported: 'ollama', 'local_deterministic', 'openai', 'anthropic'`);
}

/**
 * Enforces local-only policy invariant.
 * Throws an explicit error if a cloud provider or external API is requested while local-only mode is active.
 */
export function assertLocalInferencePolicy(requestedProvider?: string): void {
  if (config.inference.localOnly) {
    const p = (requestedProvider || config.inference.provider || 'ollama').toLowerCase();
    const cloudProviders = ['openai', 'anthropic', 'cohere', 'gemini', 'azure', 'bedrock', 'replicate', 'cloud'];
    if (cloudProviders.includes(p)) {
      throw new Error(
        `Cloud inference provider '${requestedProvider}' is strictly disabled because LOCAL_INFERENCE_ONLY is active.`
      );
    }
  }
}

/**
 * Unified helper to execute grounded generation via ModelRouter.
 */
export async function executeGroundedInference(
  request: GenerationRequest,
  options: { allowFallback?: boolean; provider?: string } = {}
): Promise<ModelRoutingResult> {
  const router = getModelRouter();
  return await router.route({
    ...request,
    forceProvider: options.provider,
  });
}


