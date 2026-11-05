/**
 * Frontend Data Models for Nexus AI Multi-Project Platform Dashboard (Day 20)
 */

export type NavigationTab =
  | 'dashboard'
  | 'projects'
  | 'knowledge-bases'
  | 'assistants'
  | 'widget-config'
  | 'playground'
  | 'showcases';

export type ShowcaseSubTab = 'sentinel' | 'docs' | 'cloud';

export type ModelPolicy = 'local-only' | 'cloud-preferred' | 'hybrid' | 'cloud-only';

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  organization_id?: string;
  status: string;
  created_at: string;
  role?: string;
  joined_at?: string;
  assistantCount?: number;
  knowledgeSpaceCount?: number;
  documentCount?: number;
}

export interface AssistantThemeConfig {
  primaryColor?: string;
  darkMode?: boolean;
  fontFamily?: string;
  brandLogoUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
  backgroundColor?: string;
  textColor?: string;
  bubbleColor?: string;
}

export interface AssistantSummary {
  id: string;
  workspace_id: string;
  application_id?: string | null;
  name: string;
  assistant_key: string;
  description?: string | null;
  system_prompt?: string;
  model_policy: ModelPolicy;
  temperature: number;
  status: string;
  public_embed_allowed: boolean;
  avatar_url?: string | null;
  theme?: AssistantThemeConfig;
  greeting_message?: string | null;
  suggested_prompts?: string[];
  created_at: string;
  updated_at?: string;
  linkedKnowledgeSpaces?: KnowledgeSpaceSummary[];
}

export interface AssistantKnowledgeSpaceLink {
  id: string;
  assistant_id: string;
  knowledge_space_id: string;
  created_at: string;
}

export interface KnowledgeSpaceSummary {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  created_at: string;
  updated_at?: string;
  document_count?: number;
}

export interface DocumentSourceSummary {
  id: string;
  workspaceId: string;
  knowledgeSpaceId: string;
  knowledgeSpaceName?: string;
  assistantId?: string | null;
  assistantName?: string | null;
  title: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
  status: 'uploaded' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed' | 'ready';
  warnings: Array<{ code: string; message: string; location?: string; severity?: string }>;
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  extractedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  chunkCount?: number;
  totalTokens?: number;
  extractedTextPreview?: string;
}

export interface DocumentChunkSummary {
  id: string;
  workspaceId?: string;
  knowledgeSpaceId?: string;
  sourceId?: string;
  versionId?: string;
  chunkIndex?: number;
  content: string;
  tokenCount?: number;
  chunkHash?: string;
  sectionPath?: string | null;
  pageNumber?: number | null;
  sourceOffset?: number | null;
  isActive?: boolean;
  metadata?: Record<string, any>;
  createdAt?: string;
  versionNumber?: number;
  // Fallback aliases for snake_case
  chunk_index?: number;
  token_count?: number;
  section_path?: string | null;
  page_number?: number | null;
}

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  sha256: string;
  status: string;
  isCurrent: boolean;
  chunkCount: number;
  totalTokens: number;
  createdAt: string;
}

export interface IngestionJobSummary {
  id: string;
  workspaceId: string;
  knowledgeSpaceId: string;
  sourceId?: string;
  jobType: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  diagnosticMessage?: string | null;
  createdAt: string;
}

export interface UploadProgressState {
  file: File;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export interface PlatformHealth {
  status: 'healthy' | 'degraded' | 'offline';
  provider?: string;
  activeModel?: string;
  localOnly?: boolean;
  modelsAvailable?: string[];
  offlineMode?: boolean;
  databaseConnected?: boolean;
  vectorExtensionReady?: boolean;
}

export interface ActivityLogItem {
  id: string;
  timestamp: string;
  action: string;
  resourceType: 'project' | 'assistant' | 'knowledge_space' | 'document' | 'widget' | 'query';
  title: string;
  details?: string;
  status: 'success' | 'warning' | 'error';
}

export interface WidgetCustomizationConfig {
  assistantId: string;
  title: string;
  primaryColor: string;
  darkMode: boolean;
  position: 'bottom-right' | 'bottom-left';
  greetingMessage: string;
  suggestedPrompts: string[];
  apiBaseUrl: string;
}

