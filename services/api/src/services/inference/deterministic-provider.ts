/**
 * NomaanOS Nexus AI - Deterministic Local Inference Provider (Day 16)
 *
 * Implements a 100% offline, reproducible inference provider for test suites,
 * zero-GPU development, and deterministic grounded synthesis validation.
 */

import type {
  InferenceProvider,
  GenerationRequest,
  GenerationResponse,
  ProviderHealthResponse,
  InferenceModelInfo,
  ModelCapabilityInfo,
} from './types.js';

export class DeterministicLocalProvider implements InferenceProvider {
  readonly name = 'local_deterministic';
  readonly defaultModel: string;

  constructor(defaultModel = 'nexus-deterministic-v1') {
    this.defaultModel = defaultModel;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;

    // Check cancellation
    if (request.signal?.aborted) {
      throw new Error('Inference request was cancelled by client.');
    }

    let content = '';

    if (request.format === 'json') {
      content = JSON.stringify(
        {
          status: 'completed',
          model,
          promptSummary: request.prompt.slice(0, 100),
          structuredData: {
            triageResult: 'verified',
            actionRequired: false,
          },
        },
        null,
        2
      );
    } else {
      content = `[Local Deterministic Response] Generated grounded response for query regarding: ${request.prompt.slice(0, 80)}`;
    }

    return {
      content,
      model,
      provider: this.name,
      promptTokens: Math.ceil(request.prompt.length / 4),
      completionTokens: Math.ceil(content.length / 4),
      totalTokens: Math.ceil((request.prompt.length + content.length) / 4),
      finishReason: 'stop',
      durationMs: Date.now() - startTime,
    };
  }

  async generateStream(
    request: GenerationRequest,
    onChunk: (delta: string) => void
  ): Promise<GenerationResponse> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;

    if (request.signal?.aborted) {
      return {
        content: '',
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        finishReason: 'cancelled',
        durationMs: 0,
      };
    }

    const fullResponse = await this.generate(request);
    const tokens = fullResponse.content.split(' ');

    for (let i = 0; i < tokens.length; i++) {
      if (request.signal?.aborted) {
        return {
          content: tokens.slice(0, i).join(' '),
          model,
          promptTokens: fullResponse.promptTokens,
          completionTokens: i,
          totalTokens: (fullResponse.promptTokens || 0) + i,
          finishReason: 'cancelled',
          durationMs: Date.now() - startTime,
        };
      }
      const delta = (i === 0 ? '' : ' ') + tokens[i];
      onChunk(delta);
    }

    return fullResponse;
  }

  async checkHealth(): Promise<ProviderHealthResponse> {
    return {
      provider: this.name,
      status: 'ready',
      baseUrl: 'in-process://deterministic',
      currentModel: this.defaultModel,
      availableModels: [this.defaultModel, 'nexus-deterministic-v1'],
      isCloud: false,
      capabilities: {
        streaming: true,
        jsonMode: true,
        contextLength: 8192,
        vision: false,
        tools: true,
        thinking: true,
      },
      version: '1.0.0-deterministic',
    };
  }

  async listModels(): Promise<InferenceModelInfo[]> {
    return [
      {
        name: this.defaultModel,
        provider: this.name,
        isCloud: false,
        capabilities: {
          streaming: true,
          jsonMode: true,
          contextLength: 8192,
          vision: false,
          tools: true,
        },
        isAvailable: true,
        parameterSize: '0B',
      },
    ];
  }

  async getModelCapabilities(): Promise<ModelCapabilityInfo> {
    return {
      streaming: true,
      jsonMode: true,
      contextLength: 8192,
      vision: false,
      tools: true,
      thinking: true,
    };
  }
}

