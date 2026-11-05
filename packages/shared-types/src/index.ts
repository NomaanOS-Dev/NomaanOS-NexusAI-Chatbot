import { z } from 'zod';

// ============================================================================
// 1. Core Tenant Hierarchy & Roles
// ============================================================================

export type TenantStatus = 'active' | 'suspended' | 'archived';

export type WorkspaceRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  analyst: 2,
  viewer: 1,
};

export function isRoleSufficient(userRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: TenantStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  workspaceId: string;
  name: string;
  appKey: string;
  status: TenantStatus;
  allowedOrigins: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 2. Assistants & Inference Settings
// ============================================================================

export type ModelPolicy = 'local-only' | 'cloud-preferred' | 'hybrid' | 'cloud-only';

export interface AssistantTheme {
  primaryColor: string;
  fontFamily: string;
  darkMode: boolean;
  brandLogoUrl?: string;
}

export interface Assistant {
  id: string;
  workspaceId: string;
  applicationId?: string | null;
  name: string;
  assistantKey: string;
  description?: string | null;
  systemPrompt: string;
  modelPolicy: ModelPolicy;
  temperature: number;
  status: TenantStatus;
  publicEmbedAllowed: boolean;
  avatarUrl?: string | null;
  theme?: AssistantTheme;
  greetingMessage?: string;
  suggestedPrompts?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicAssistantConfig {
  assistantId: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  theme: AssistantTheme;
  greetingMessage: string;
  suggestedPrompts: string[];
  capabilities: {
    streaming: boolean;
    fileUpload: boolean;
    feedback: boolean;
    citations: boolean;
  };
}

// ============================================================================
// 3. Knowledge Spaces, Documents & Ingestion
// ============================================================================

export type IngestionJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface KnowledgeSpace {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSource {
  id: string;
  workspaceId: string;
  knowledgeSpaceId: string;
  title: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
  sha256: string;
  status: 'pending' | 'ready' | 'error' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  sourceId: string;
  versionNumber: number;
  sha256: string;
  createdAt: string;
}

export interface DocumentChunk {
  id: string;
  workspaceId: string;
  knowledgeSpaceId: string;
  sourceId: string;
  versionId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: {
    pageNumber?: number;
    sectionHeader?: string;
    lineStart?: number;
    lineEnd?: number;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface IngestionJob {
  id: string;
  workspaceId: string;
  sourceId: string;
  status: IngestionJobStatus;
  attempts: number;
  maxAttempts: number;
  lockedAt?: string | null;
  lockedBy?: string | null;
  leaseExpiresAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 4. Conversations, Messages & Citations
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type CitationValidationStatus = 'verified' | 'unverified' | 'invalid' | 'inaccessible' | 'fabricated';

export interface MessageCitation {
  citationIndex: number;
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  excerpt: string;
  relevanceScore?: number;
  sectionPath?: string | null;
  pageNumber?: number | null;
  versionNumber?: number;
  sourceUrl?: string | null;
  validationStatus?: CitationValidationStatus;
  validationReason?: string | null;
  claimSupportScore?: number | null;
}

export type ToolExecutionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'rejected_unauthorized'
  | 'validation_error'
  | 'running'
  | 'success'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'unverified';

export interface ToolExecutionRecord {
  id: string;
  conversationId: string;
  messageId?: string | null;
  toolName: string;
  status: ToolExecutionStatus;
  inputArguments: Record<string, unknown>;
  outputPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  tokenCount?: number;
  finishReason?: string;
  citations?: MessageCitation[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  assistantId: string;
  title: string;
  createdBy?: string | null;
  anonymousSessionToken?: string | null;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ResponseStyle = 'concise' | 'detailed' | 'standard' | 'bullet_points' | 'executive';

export interface UserPreferences {
  id?: string;
  userId: string;
  workspaceId?: string | null;
  language: string;
  responseStyle: ResponseStyle;
  codeTheme?: string | null;
  customInstructions?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationSummary {
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

export interface WorkspaceRetentionPolicy {
  workspaceId: string;
  conversationRetentionDays: number;
  summaryRetentionDays: number;
  preferencesRetentionDays: number;
  autoPurgeEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResponseFormat {
  type: 'text' | 'json_object';
  schema?: Record<string, unknown>;
  schemaName?: string;
}

// ============================================================================
// 5. Server-Sent Events (SSE) Protocol Types
// ============================================================================

export interface SSEMessageStartEvent {
  messageId: string;
  conversationId: string;
  role: 'assistant';
}

export interface SSEContentDeltaEvent {
  delta: string;
}

export interface SSECitationsEvent {
  citations: MessageCitation[];
}

export interface SSEToolCallStartEvent {
  toolExecutionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface SSEApprovalRequiredEvent {
  approvalId: string;
  toolName: string;
  proposedAction: string;
  expiresAt: string;
}

export interface SSEMessageCompleteEvent {
  messageId: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationMs: number;
}

export interface SSEErrorEvent {
  code: string;
  message: string;
  details?: unknown;
}

export type SSEResponseEvent =
  | { event: 'message_start'; data: SSEMessageStartEvent }
  | { event: 'content_delta'; data: SSEContentDeltaEvent }
  | { event: 'citations'; data: SSECitationsEvent }
  | { event: 'tool_call_start'; data: SSEToolCallStartEvent }
  | { event: 'approval_required'; data: SSEApprovalRequiredEvent }
  | { event: 'message_complete'; data: SSEMessageCompleteEvent }
  | { event: 'error'; data: SSEErrorEvent };

// ============================================================================
// 6. Audit & Governance
// ============================================================================

export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: string;
}

// ============================================================================
// 7. Standard API Errors & Envelopes
// ============================================================================

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
}

export interface ReadinessCheckResponse {
  status: 'ready' | 'unavailable';
  checks: {
    database: 'ok' | 'failed';
    pgvector: 'ok' | 'failed';
  };
  latencyMs?: number;
  error?: string;
}

// ============================================================================
// 8. Runtime Validation Schemas (Zod)
// ============================================================================

export const UUID_SCHEMA = z.string().uuid({ message: 'Must be a valid UUID' });

export const SLUG_SCHEMA = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must contain only lowercase letters, numbers, and single hyphens',
  });

export const CreateOrganizationSchema = z.object({
  name: z.string().min(2).max(255),
  slug: SLUG_SCHEMA,
  metadata: z.record(z.unknown()).optional(),
});

export const CreateWorkspaceSchema = z.object({
  organizationId: UUID_SCHEMA,
  name: z.string().min(2).max(255),
  slug: SLUG_SCHEMA,
  metadata: z.record(z.unknown()).optional(),
});

export const CreateApplicationSchema = z.object({
  workspaceId: UUID_SCHEMA,
  name: z.string().min(2).max(255),
  appKey: z.string().min(2).max(128).regex(/^[a-z0-9_\-]+$/i, {
    message: 'App key must contain alphanumeric, underscore, or hyphen characters',
  }),
  allowedOrigins: z.array(z.string().url()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const CreateAssistantSchema = z.object({
  workspaceId: UUID_SCHEMA,
  applicationId: UUID_SCHEMA.optional().nullable(),
  name: z.string().min(2).max(255),
  assistantKey: z.string().min(2).max(128).regex(/^[a-z0-9_\-]+$/i),
  description: z.string().max(1000).optional().nullable(),
  systemPrompt: z.string().min(10).max(10000),
  modelPolicy: z.enum(['local-only', 'cloud-preferred', 'hybrid', 'cloud-only']).default('cloud-preferred'),
  temperature: z.number().min(0.0).max(2.0).default(0.2),
  publicEmbedAllowed: z.boolean().default(false),
  avatarUrl: z.string().url().optional().nullable(),
  greetingMessage: z.string().max(500).optional(),
  suggestedPrompts: z.array(z.string().max(200)).max(5).optional(),
});

export const CreateKnowledgeSpaceSchema = z.object({
  workspaceId: UUID_SCHEMA,
  name: z.string().min(2).max(255),
  slug: SLUG_SCHEMA,
  description: z.string().max(1000).optional().nullable(),
});

export const CreateConversationSchema = z.object({
  assistantId: UUID_SCHEMA,
  title: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(30000),
  knowledgeSpaceIds: z.array(UUID_SCHEMA).optional(),
  stream: z.boolean().default(true),
});

// ============================================================================
// 12. Inference & Model Provider Types (Day 16 & Day 17)
// ============================================================================

export type InferenceProviderType = 'ollama' | 'local_deterministic' | 'openai' | 'anthropic' | 'custom' | string;

export type ModelRoutingPolicy =
  | 'local-only'
  | 'cloud-preferred'
  | 'hybrid'
  | 'cloud-only'
  | 'local_only'
  | 'cloud_preferred'
  | 'cloud_only';

export type TaskComplexity = 'simple' | 'standard' | 'complex';

export interface ModelCapabilityInfo {
  streaming: boolean;
  jsonMode: boolean;
  contextLength: number;
  vision?: boolean;
  tools?: boolean;
  thinking?: boolean;
  costPer1kInputTokens?: number;
  costPer1kOutputTokens?: number;
  isCloud?: boolean;
}

export interface InferenceModelInfo {
  name: string;
  id?: string;
  provider: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantizationLevel?: string;
  family?: string;
  capabilities: ModelCapabilityInfo;
  isAvailable: boolean;
  isCloud: boolean;
}

export interface ProviderHealthResponse {
  provider: InferenceProviderType | string;
  status: 'ready' | 'degraded' | 'unavailable' | 'model_not_found' | 'rate_limited';
  baseUrl: string;
  currentModel: string;
  availableModels: string[];
  capabilities: ModelCapabilityInfo;
  isCloud: boolean;
  rateLimited?: boolean;
  rateLimitResetAt?: string;
  version?: string;
  error?: string;
}

export interface GenerationRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  format?: 'json' | string;
  stop?: string[];
  stream?: boolean;
  signal?: AbortSignal;
  workspaceId?: string;
  assistantId?: string;
  conversationId?: string;
  routingPolicy?: ModelRoutingPolicy;
  forceProvider?: string;
  containsSensitiveData?: boolean;
}

export interface GenerationResponse {
  content: string;
  model: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
  durationMs?: number;
  estimatedCostUsd?: number;
}

export interface RoutingDecision {
  targetProvider: string;
  targetModel: string;
  policy: ModelRoutingPolicy;
  taskComplexity: TaskComplexity;
  reason: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  isCloud: boolean;
}

export interface ModelRoutingResult extends GenerationResponse {
  routingDecision: RoutingDecision;
  fallbackTriggered?: boolean;
  fallbackReason?: string;
  primaryError?: string;
}

export interface InferenceUsageRecord {
  id: string;
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
  createdAt: string;
}

export interface InferenceFailureRecord {
  id: string;
  workspaceId?: string;
  provider: string;
  model: string;
  errorCode: string;
  statusCode?: number;
  errorMessage: string;
  routingPolicy: string;
  fallbackTriggered: boolean;
  fallbackProvider?: string;
  createdAt: string;
}

export interface InferenceMetricsSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbackRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  averageDurationMs: number;
  providerBreakdown: Record<string, { requests: number; failures: number; tokens: number; costUsd: number }>;
  policyBreakdown: Record<string, { requests: number; fallbacks: number }>;
}

// ============================================================================
// 13. Offline Deployment & Knowledge Transfer Types (Day 18)
// ============================================================================

export interface OfflinePackageManifest {
  version: string;
  packageId: string;
  exportedAt: string;
  sourceWorkspaceId: string;
  knowledgeSpaceName: string;
  knowledgeSpaceSlug: string;
  documentCount: number;
  chunkCount: number;
  embeddingModel: string;
  checksum: string;
}

export interface OfflinePackageChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  sectionPath?: string | null;
  pageNumber?: number | null;
  sourceOffset?: number | null;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}

export interface OfflinePackageDocument {
  sourceId: string;
  title: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
  metadata?: Record<string, unknown>;
  versionNumber: number;
  chunks: OfflinePackageChunk[];
}

export interface OfflineKnowledgePackage {
  manifest: OfflinePackageManifest;
  documents: OfflinePackageDocument[];
}

export interface KnowledgeImportResult {
  status: 'success' | 'failed';
  packageId: string;
  knowledgeSpaceId: string;
  knowledgeSpaceName: string;
  importedDocuments: number;
  importedChunks: number;
  verifiedChecksum: boolean;
  message: string;
}

export interface OfflineSystemStatus {
  offlineMode: boolean;
  airGapped: boolean;
  remoteDataAvailable: boolean;
  localInferenceOnly: boolean;
  activeInferenceProvider: string;
  embeddingDaemonActive: boolean;
  databaseConnected: boolean;
  vectorExtensionReady: boolean;
}

// ============================================================================
// 15. Day 19: Tool Registry, Agent Loop & Tool Execution Records
// ============================================================================

export interface ToolExecutionContext {
  userId: string;
  workspaceId: string;
  organizationId?: string;
  role: WorkspaceRole;
  correlationId?: string;
  assistantId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  displayName: string;
  description: string;
  parameters: Record<string, any>;
  inputSchema?: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  requiredRole?: WorkspaceRole;
  requiredPermissions?: string[];
  timeoutMs?: number;
  enabled?: boolean;
  handler?: (args: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

export interface ToolSummary {
  name: string;
  displayName: string;
  description: string;
  parameters: Record<string, any>;
  requiredRole: WorkspaceRole;
  enabled: boolean;
}

export interface ToolCallProposal {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionResult<T = any> {
  callId: string;
  toolName: string;
  status: ToolExecutionStatus;
  output?: T;
  error?: string;
  errorCode?: string;
  durationMs: number;
  timestamp: string;
}

export interface AgentLoopConfig {
  maxIterations?: number;
  maxToolCalls?: number;
  perToolTimeoutMs?: number;
  overallTimeoutMs?: number;
  allowedTools?: string[];
}

export interface AgentLoopIteration {
  iteration: number;
  modelResponse?: string;
  toolProposals: ToolCallProposal[];
  toolResults: ToolExecutionResult[];
  durationMs: number;
}

export type AgentLoopStopReason =
  | 'completed'
  | 'max_iterations_reached'
  | 'max_tool_calls_reached'
  | 'timeout'
  | 'cancelled'
  | 'tool_failure';

export interface AgentToolExecutionRecord {
  id: string;
  workspaceId: string;
  userId?: string | null;
  assistantId?: string | null;
  conversationId?: string | null;
  toolName: string;
  status: ToolExecutionStatus;
  durationMs: number;
  correlationId?: string | null;
  sanitizedArguments: Record<string, unknown>;
  outputSummary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface AgentLoopResult {
  finalResponse: string;
  iterations: AgentLoopIteration[];
  totalToolCalls: number;
  totalDurationMs: number;
  stopReason: AgentLoopStopReason;
  records: AgentToolExecutionRecord[];
}





