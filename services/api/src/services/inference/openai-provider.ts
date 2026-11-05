/**
 * NomaanOS Nexus AI - OpenAI Cloud Inference Provider (Day 17)
 *
 * Implements cloud inference adapter for OpenAI and OpenAI-compatible APIs
 * (e.g. OpenAI, Azure OpenAI, vLLM, OpenRouter, Groq).
 * Features:
 * - Normalized completion and SSE streaming
 * - Rate-limit handling (429 + Retry-After)
 * - Credential protection and redaction
 * - JSON structured output mode
 * - Pluggable fetchFn for deterministic offline tests
 */

import { logger } from '../../config/logger.js';
import { maskApiKey } from '../tokens.js';
import type {
  InferenceProvider,
  GenerationRequest,
  GenerationResponse,
  ProviderHealthResponse,
  InferenceModelInfo,
  ModelCapabilityInfo,
} from './types.js';
import {
  InferenceError,
  RateLimitError,
  ProviderUnavailableError,
  CredentialsMissingError,
} from './errors.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OpenAIInferenceProvider implements InferenceProvider {
  readonly name = 'openai';
  readonly isCloud = true;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAIProviderOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'gpt-4o-mini';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  /**
   * Generates a complete non-streaming response.
   */
  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const startTime = Date.now();
    const apiKey = this.resolveApiKey();
    const model = request.model || this.defaultModel;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener('abort', () => controller.abort());
      }
    }

    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const payload: Record<string, unknown> = {
        model,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1024,
        stream: false,
      };

      if (request.format === 'json') {
        payload.response_format = { type: 'json_object' };
      }
      if (request.stop && request.stop.length > 0) {
        payload.stop = request.stop;
      }

      const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleHttpError(res);
      }

      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content || '';
      const finishReason = data.choices?.[0]?.finish_reason || 'stop';
      const promptTokens = data.usage?.prompt_tokens ?? 0;
      const completionTokens = data.usage?.completion_tokens ?? 0;
      const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
      const durationMs = Date.now() - startTime;

      // Estimate cost based on standard model pricing (e.g. gpt-4o-mini ~ $0.15 / 1M input, $0.60 / 1M output)
      const estimatedCostUsd = (promptTokens * 0.15 + completionTokens * 0.6) / 1_000_000;

      return {
        content,
        model: data.model || model,
        provider: this.name,
        promptTokens,
        completionTokens,
        totalTokens,
        finishReason,
        durationMs,
        estimatedCostUsd,
      };
    } catch (err: any) {
      this.normalizeException(err);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generates a streaming response, invoking onChunk for each text delta.
   */
  async generateStream(
    request: GenerationRequest,
    onChunk: (delta: string) => void
  ): Promise<GenerationResponse> {
    const startTime = Date.now();
    const apiKey = this.resolveApiKey();
    const model = request.model || this.defaultModel;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener('abort', () => controller.abort());
      }
    }

    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const payload: Record<string, unknown> = {
        model,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1024,
        stream: true,
      };

      if (request.format === 'json') {
        payload.response_format = { type: 'json_object' };
      }
      if (request.stop && request.stop.length > 0) {
        payload.stop = request.stop;
      }

      const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleHttpError(res);
      }

      if (!res.body) {
        throw new InferenceError('OpenAI streaming response body is null', this.name, 502);
      }

      let accumulatedContent = '';
      let finishReason: 'stop' | 'length' | 'cancelled' | 'error' = 'stop';
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedContent += delta;
              onChunk(delta);
            }
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }
          } catch {
            // Ignore partial SSE json parsing lines
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const promptTokensEstimate = Math.ceil((request.prompt.length + (request.systemPrompt?.length || 0)) / 4);
      const completionTokensEstimate = Math.ceil(accumulatedContent.length / 4);

      return {
        content: accumulatedContent,
        model,
        provider: this.name,
        promptTokens: promptTokensEstimate,
        completionTokens: completionTokensEstimate,
        totalTokens: promptTokensEstimate + completionTokensEstimate,
        finishReason,
        durationMs,
        estimatedCostUsd: (promptTokensEstimate * 0.15 + completionTokensEstimate * 0.6) / 1_000_000,
      };
    } catch (err: any) {
      this.normalizeException(err);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check for OpenAI provider.
   */
  async checkHealth(): Promise<ProviderHealthResponse> {
    if (!this.apiKey) {
      return {
        provider: this.name,
        status: 'degraded',
        baseUrl: this.baseUrl,
        currentModel: this.defaultModel,
        availableModels: [this.defaultModel],
        isCloud: true,
        capabilities: await this.getModelCapabilities(),
        error: 'API key not configured',
      };
    }

    try {
      const res = await this.fetchFn(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        if (res.status === 429) {
          return {
            provider: this.name,
            status: 'rate_limited',
            baseUrl: this.baseUrl,
            currentModel: this.defaultModel,
            availableModels: [this.defaultModel],
            isCloud: true,
            rateLimited: true,
            capabilities: await this.getModelCapabilities(),
            error: 'OpenAI rate limit active',
          };
        }
        return {
          provider: this.name,
          status: 'unavailable',
          baseUrl: this.baseUrl,
          currentModel: this.defaultModel,
          availableModels: [this.defaultModel],
          isCloud: true,
          capabilities: await this.getModelCapabilities(),
          error: `HTTP ${res.status}: ${res.statusText}`,
        };
      }

      return {
        provider: this.name,
        status: 'ready',
        baseUrl: this.baseUrl,
        currentModel: this.defaultModel,
        availableModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
        isCloud: true,
        capabilities: await this.getModelCapabilities(),
      };
    } catch (err: any) {
      return {
        provider: this.name,
        status: 'unavailable',
        baseUrl: this.baseUrl,
        currentModel: this.defaultModel,
        availableModels: [this.defaultModel],
        isCloud: true,
        capabilities: await this.getModelCapabilities(),
        error: err.message,
      };
    }
  }

  /**
   * Lists available models.
   */
  async listModels(): Promise<InferenceModelInfo[]> {
    const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'];
    return models.map((m) => ({
      name: m,
      id: m,
      provider: this.name,
      family: 'gpt',
      isCloud: true,
      isAvailable: Boolean(this.apiKey),
      capabilities: {
        streaming: true,
        jsonMode: true,
        contextLength: 128000,
        vision: true,
        tools: true,
        costPer1kInputTokens: 0.00015,
        costPer1kOutputTokens: 0.0006,
        isCloud: true,
      },
    }));
  }

  /**
   * Capabilities for the model.
   */
  async getModelCapabilities(modelName?: string): Promise<ModelCapabilityInfo> {
    return {
      streaming: true,
      jsonMode: true,
      contextLength: 128000,
      vision: true,
      tools: true,
      costPer1kInputTokens: 0.00015,
      costPer1kOutputTokens: 0.0006,
      isCloud: true,
    };
  }

  /**
   * Returns masked API key fingerprint for security logging.
   */
  getMaskedApiKey(): string {
    return this.apiKey ? maskApiKey(this.apiKey) : 'none';
  }

  private resolveApiKey(): string {
    if (!this.apiKey) {
      throw new CredentialsMissingError(this.name);
    }
    return this.apiKey;
  }

  private async handleHttpError(res: Response): Promise<never> {
    let errorBody: any = {};
    try {
      errorBody = await res.json();
    } catch {
      // not JSON
    }

    const message = errorBody?.error?.message || `OpenAI API returned status ${res.status}`;

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) || 30 : 30;
      throw new RateLimitError(this.name, retryAfterSeconds, message);
    }

    if (res.status === 401 || res.status === 403) {
      throw new CredentialsMissingError(this.name);
    }

    if (res.status >= 500) {
      throw new ProviderUnavailableError(this.name, message, res.status);
    }

    throw new InferenceError(message, this.name, res.status);
  }

  private normalizeException(err: any): void {
    if (err.name === 'AbortError') {
      throw new InferenceError(`OpenAI inference timed out or was aborted after ${this.timeoutMs}ms`, this.name, 504);
    }
  }
}

