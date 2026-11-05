/**
 * NomaanOS Nexus AI - Ollama Local Inference Provider (Day 16)
 *
 * Implements local model inference using a local Ollama daemon via its HTTP REST API.
 * Features:
 * - Single generation and incremental streaming (NDJSON -> SSE)
 * - Structured JSON output constraint enforcement (format: 'json')
 * - Active health checks, model discovery, and capability detection
 * - Bounded timeouts, resource limits, and AbortController cancellation
 */

import { logger } from '../../config/logger.js';
import type {
  InferenceProvider,
  GenerationRequest,
  GenerationResponse,
  ProviderHealthResponse,
  InferenceModelInfo,
  ModelCapabilityInfo,
} from './types.js';

export interface OllamaProviderOptions {
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
  keepAlive?: string;
  temperature?: number;
  maxTokens?: number;
}

export class OllamaInferenceProvider implements InferenceProvider {
  readonly name = 'ollama';
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly timeoutMs: number;
  readonly keepAlive: string;
  readonly temperature: number;
  readonly maxTokens: number;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'qwen3.8:27b';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.keepAlive = options.keepAlive || '5m';
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens ?? 2048;
  }

  /**
   * Generates a complete non-streaming response.
   */
  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    // Link external cancellation signal if provided
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
        prompt: request.prompt,
        system: request.systemPrompt,
        stream: false,
        keep_alive: this.keepAlive,
        options: {
          temperature: request.temperature ?? this.temperature,
          num_predict: request.maxTokens ?? this.maxTokens,
          stop: request.stop,
        },
      };

      if (request.format === 'json') {
        payload.format = 'json';
      }

      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if (res.status === 404) {
          throw new Error(
            `Model '${model}' not found in Ollama. Pull it locally using 'ollama pull ${model}' (status 404). Details: ${errText}`
          );
        }
        throw new Error(`Ollama generation failed [HTTP ${res.status}]: ${errText || res.statusText}`);
      }

      const data: any = await res.json();
      const durationMs = Date.now() - startTime;

      return {
        content: data.response || '',
        model: data.model || model,
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        finishReason: 'stop',
        durationMs,
      };
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        if (request.signal?.aborted) {
          throw new Error('Inference request was cancelled by client.');
        }
        throw new Error(`Ollama inference request timed out after ${this.timeoutMs}ms.`);
      }
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new Error(
          `Ollama daemon is unreachable at ${this.baseUrl}. Ensure Ollama is running ('ollama serve').`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generates a streaming response, invoking onChunk for each incoming token chunk.
   */
  async generateStream(
    request: GenerationRequest,
    onChunk: (delta: string) => void
  ): Promise<GenerationResponse> {
    const startTime = Date.now();
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

    let accumulatedContent = '';
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const payload: Record<string, unknown> = {
        model,
        prompt: request.prompt,
        system: request.systemPrompt,
        stream: true,
        keep_alive: this.keepAlive,
        options: {
          temperature: request.temperature ?? this.temperature,
          num_predict: request.maxTokens ?? this.maxTokens,
          stop: request.stop,
        },
      };

      if (request.format === 'json') {
        payload.format = 'json';
      }

      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if (res.status === 404) {
          throw new Error(
            `Model '${model}' not found in Ollama. Pull it locally using 'ollama pull ${model}' (status 404). Details: ${errText}`
          );
        }
        throw new Error(`Ollama stream failed [HTTP ${res.status}]: ${errText || res.statusText}`);
      }

      if (!res.body) {
        throw new Error('Ollama streaming response body is empty.');
      }

      // Read NDJSON stream from response body
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.response) {
              accumulatedContent += parsed.response;
              onChunk(parsed.response);
            }
            if (parsed.done) {
              promptTokens = parsed.prompt_eval_count || 0;
              completionTokens = parsed.eval_count || 0;
            }
          } catch {
            // Incomplete JSON chunk in stream line; ignore or buffer
          }
        }
      }

      // Flush remaining buffer if valid
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.response) {
            accumulatedContent += parsed.response;
            onChunk(parsed.response);
          }
          if (parsed.done) {
            promptTokens = parsed.prompt_eval_count || promptTokens;
            completionTokens = parsed.eval_count || completionTokens;
          }
        } catch {}
      }

      const durationMs = Date.now() - startTime;

      return {
        content: accumulatedContent,
        model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        finishReason: 'stop',
        durationMs,
      };
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        if (request.signal?.aborted) {
          return {
            content: accumulatedContent,
            model,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            finishReason: 'cancelled',
            durationMs: Date.now() - startTime,
          };
        }
        throw new Error(`Ollama streaming request timed out after ${this.timeoutMs}ms.`);
      }
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new Error(
          `Ollama daemon is unreachable at ${this.baseUrl}. Ensure Ollama is running ('ollama serve').`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check and capability verification.
   */
  async checkHealth(): Promise<ProviderHealthResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      // Check version
      const verRes = await fetch(`${this.baseUrl}/api/version`, {
        signal: controller.signal,
      }).catch(() => null);

      let version: string | undefined;
      if (verRes && verRes.ok) {
        const vData: any = await verRes.json().catch(() => ({}));
        version = vData.version;
      }

      // List models
      const models = await this.listModels();
      clearTimeout(timeoutId);

      const availableNames = models.map((m) => m.name);
      const isCurrentAvailable = availableNames.some(
        (n) => n === this.defaultModel || n.startsWith(`${this.defaultModel}:`)
      );

      const capabilities = await this.getModelCapabilities(this.defaultModel);

      if (!isCurrentAvailable && availableNames.length === 0) {
        return {
          provider: this.name,
          status: 'ready',
          baseUrl: this.baseUrl,
          currentModel: this.defaultModel,
          availableModels: [],
          capabilities,
          isCloud: false,
          version,
          error: `Ollama is running, but no models are currently pulled. Run 'ollama pull ${this.defaultModel}' to download.`,
        };
      }

      if (!isCurrentAvailable) {
        return {
          provider: this.name,
          status: 'model_not_found',
          baseUrl: this.baseUrl,
          currentModel: this.defaultModel,
          availableModels: availableNames,
          capabilities,
          isCloud: false,
          version,
          error: `Configured model '${this.defaultModel}' not found in Ollama. Available: ${availableNames.join(', ')}`,
        };
      }

      return {
        provider: this.name,
        status: 'ready',
        baseUrl: this.baseUrl,
        currentModel: this.defaultModel,
        availableModels: availableNames,
        capabilities,
        isCloud: false,
        version,
      };
    } catch (err: any) {
      return {
        provider: this.name,
        status: 'unavailable',
        baseUrl: this.baseUrl,
        currentModel: this.defaultModel,
        availableModels: [],
        isCloud: false,
        capabilities: {
          streaming: false,
          jsonMode: false,
          contextLength: 0,
        },
        error: `Ollama service unreachable at ${this.baseUrl}: ${err.message}`,
      };
    }
  }

  /**
   * Lists models installed in Ollama.
   */
  async listModels(): Promise<InferenceModelInfo[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return [];

      const data: any = await res.json();
      const rawModels = Array.isArray(data.models) ? data.models : [];

      return rawModels.map((m: any) => {
        const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
        return {
          name: m.name,
          id: m.digest?.slice(0, 12),
          provider: this.name,
          isCloud: false,
          sizeBytes: m.size,
          parameterSize: m.details?.parameter_size,
          quantizationLevel: m.details?.quantization_level,
          family: m.details?.family,
          capabilities: {
            streaming: true,
            jsonMode: true,
            contextLength: m.details?.context_length || 4096,
            vision: caps.includes('vision'),
            tools: caps.includes('tools'),
            thinking: caps.includes('thinking'),
            isCloud: false,
          },
          isAvailable: true,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Returns supported capabilities for the model.
   */
  async getModelCapabilities(modelName?: string): Promise<ModelCapabilityInfo> {
    const target = modelName || this.defaultModel;
    const models = await this.listModels();
    const found = models.find((m) => m.name === target || m.name.startsWith(`${target}:`));

    if (found) {
      return found.capabilities;
    }

    // Default Ollama model capabilities baseline
    return {
      streaming: true,
      jsonMode: true,
      contextLength: 4096,
      vision: false,
      tools: false,
      thinking: false,
    };
  }
}

