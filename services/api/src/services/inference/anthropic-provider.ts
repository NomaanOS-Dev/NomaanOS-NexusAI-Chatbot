/**
 * NomaanOS Nexus AI - Anthropic Cloud Inference Provider (Day 17)
 *
 * Implements cloud inference adapter for Anthropic Claude Messages API.
 * Features:
 * - Normalized completion and SSE streaming
 * - Rate-limit handling (429 + Retry-After)
 * - Credential protection and redaction
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

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class AnthropicInferenceProvider implements InferenceProvider {
  readonly name = 'anthropic';
  readonly isCloud = true;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicProviderOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'claude-3-5-haiku-20241022';
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
      const payload: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: request.prompt }],
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.2,
        stream: false,
      };

      if (request.systemPrompt) {
        payload.system = request.systemPrompt;
      }
      if (request.stop && request.stop.length > 0) {
        payload.stop_sequences = request.stop;
      }

      const res = await this.fetchFn(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleHttpError(res);
      }

      const data = (await res.json()) as any;
      let content = '';
      if (Array.isArray(data.content)) {
        content = data.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');
      }

      const promptTokens = data.usage?.input_tokens ?? 0;
      const completionTokens = data.usage?.output_tokens ?? 0;
      const totalTokens = promptTokens + completionTokens;
      const durationMs = Date.now() - startTime;

      // Estimated cost for Claude 3.5 Haiku: $0.80 / 1M input, $4.00 / 1M output
      const estimatedCostUsd = (promptTokens * 0.8 + completionTokens * 4.0) / 1_000_000;

      return {
        content,
        model: data.model || model,
        provider: this.name,
        promptTokens,
        completionTokens,
        totalTokens,
        finishReason: data.stop_reason === 'max_tokens' ? 'length' : 'stop',
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
      const payload: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: request.prompt }],
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.2,
        stream: true,
      };

      if (request.systemPrompt) {
        payload.system = request.systemPrompt;
      }
      if (request.stop && request.stop.length > 0) {
        payload.stop_sequences = request.stop;
      }

      const res = await this.fetchFn(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleHttpError(res);
      }

      if (!res.body) {
        throw new InferenceError('Anthropic streaming response body is null', this.name, 502);
      }

      let accumulatedContent = '';
      let promptTokens = 0;
      let completionTokens = 0;
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
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              accumulatedContent += parsed.delta.text;
              onChunk(parsed.delta.text);
            } else if (parsed.type === 'message_start' && parsed.message?.usage) {
              promptTokens = parsed.message.usage.input_tokens || 0;
            } else if (parsed.type === 'message_delta' && parsed.usage) {
              completionTokens = parsed.usage.output_tokens || 0;
            }
          } catch {
            // Ignore partial SSE lines
          }
        }
      }

      const durationMs = Date.now() - startTime;
      if (!promptTokens) {
        promptTokens = Math.ceil(request.prompt.length / 4);
      }
      if (!completionTokens) {
        completionTokens = Math.ceil(accumulatedContent.length / 4);
      }

      return {
        content: accumulatedContent,
        model,
        provider: this.name,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        finishReason: 'stop',
        durationMs,
        estimatedCostUsd: (promptTokens * 0.8 + completionTokens * 4.0) / 1_000_000,
      };
    } catch (err: any) {
      this.normalizeException(err);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check for Anthropic provider.
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

    return {
      provider: this.name,
      status: 'ready',
      baseUrl: this.baseUrl,
      currentModel: this.defaultModel,
      availableModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
      isCloud: true,
      capabilities: await this.getModelCapabilities(),
    };
  }

  /**
   * Lists available models.
   */
  async listModels(): Promise<InferenceModelInfo[]> {
    const models = ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];
    return models.map((m) => ({
      name: m,
      id: m,
      provider: this.name,
      family: 'claude',
      isCloud: true,
      isAvailable: Boolean(this.apiKey),
      capabilities: {
        streaming: true,
        jsonMode: true,
        contextLength: 200000,
        vision: true,
        tools: true,
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.015,
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
      contextLength: 200000,
      vision: true,
      tools: true,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
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

    const message = errorBody?.error?.message || `Anthropic API returned status ${res.status}`;

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
      throw new InferenceError(`Anthropic inference timed out or was aborted after ${this.timeoutMs}ms`, this.name, 504);
    }
  }
}

