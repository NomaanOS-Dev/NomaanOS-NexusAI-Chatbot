export type ConnectorType = 'git' | 'web' | 'api';

export interface ConnectorFileItem {
  path: string;
  filename: string;
  content: string | Buffer;
  mimeType: string;
  sha256?: string;
  metadata?: Record<string, any>;
}

export interface SyncContext {
  workspaceId: string;
  knowledgeSpaceId: string;
  sourceId: string;
  jobId: string;
  actorId?: string;
  correlationId?: string;
}

export interface SyncResult {
  success: boolean;
  connectorType: ConnectorType;
  itemsDiscovered: number;
  itemsProcessed: number;
  itemsUnchanged: number;
  itemsFailed: number;
  items: ConnectorFileItem[];
  warnings: string[];
  error?: string;
  cursorOrCommitSha?: string;
}

export interface GitConnectorConfig {
  repositoryUrl: string;
  branch?: string;
  includePaths?: string[]; // Glob / prefix patterns e.g. ["docs/**", "README.md"]
  excludePaths?: string[];
  lastCommitSha?: string;
  authHeader?: string;
}

export interface WebConnectorConfig {
  baseUrl: string;
  allowedDomains: string[];
  maxDepth?: number;
  maxPages?: number;
  allowedPathPrefixes?: string[];
  userAgent?: string;
}

export interface ApiConnectorConfig {
  endpointUrl: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  paginationType?: 'page' | 'cursor' | 'offset';
  paginationField?: string;
  maxPages?: number;
  itemsPath?: string;
  rateLimitPerMinute?: number;
}

