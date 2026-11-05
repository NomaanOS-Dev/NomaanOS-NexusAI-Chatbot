/**
 * NomaanOS Nexus AI - Inference Service Types (Day 16)
 *
 * Defines provider-agnostic interfaces for local model execution, capability reporting,
 * streaming generation, and resource cancellation.
 */

import type {
  InferenceProviderType,
  ModelCapabilityInfo,
  InferenceModelInfo,
  ProviderHealthResponse,
  GenerationRequest,
  GenerationResponse,
  ModelRoutingPolicy,
  ModelRoutingResult,
  RoutingDecision,
  TaskComplexity,
  InferenceUsageRecord,
  InferenceFailureRecord,
  InferenceMetricsSummary,
} from '@nomaanos/nexus-shared-types';

export type {
  InferenceProviderType,
  ModelCapabilityInfo,
  InferenceModelInfo,
  ProviderHealthResponse,
  GenerationRequest,
  GenerationResponse,
  ModelRoutingPolicy,
  ModelRoutingResult,
  RoutingDecision,
  TaskComplexity,
  InferenceUsageRecord,
  InferenceFailureRecord,
  InferenceMetricsSummary,
};

export interface InferenceProvider {
  readonly name: InferenceProviderType | string;
  readonly baseUrl?: string;
  readonly defaultModel: string;

  /**
   * Generates a complete response for the given prompt and options.
   */
  generate(request: GenerationRequest): Promise<GenerationResponse>;

  /**
   * Generates a streaming response, invoking onChunk for each text delta.
   */
  generateStream(
    request: GenerationRequest,
    onChunk: (delta: string) => void
  ): Promise<GenerationResponse>;

  /**
   * Performs an active health check on the inference provider and configured model.
   */
  checkHealth(): Promise<ProviderHealthResponse>;

  /**
   * Lists available models reported by the provider.
   */
  listModels(): Promise<InferenceModelInfo[]>;

  /**
   * Retrieves supported capabilities for the specified (or default) model.
   */
  getModelCapabilities(modelName?: string): Promise<ModelCapabilityInfo>;
}

