/**
 * Centralized API Client for Nexus AI Platform (Day 20)
 *
 * Connects to http://localhost:4001/api/v1 with automatic auth token management,
 * workspace context headers, error handling, and offline fallback detection.
 */

import {
  WorkspaceSummary,
  AssistantSummary,
  KnowledgeSpaceSummary,
  PlatformHealth,
  DocumentSourceSummary,
  DocumentChunkSummary,
  DocumentVersionSummary,
  IngestionJobSummary,
} from '../types';

const isBrowser = typeof window !== 'undefined';
const DEFAULT_API_BASE = isBrowser ? '' : 'http://127.0.0.1:4001';
const TOKEN_STORAGE_KEY = 'nexus_session_token';
const WORKSPACE_STORAGE_KEY = 'nexus_active_workspace_id';
const BASE_URL_STORAGE_KEY = 'nexus_api_base_url';

export class NexusApiClient {
  private static instance: NexusApiClient | null = null;
  private apiBaseUrl: string;
  private token: string | null = null;
  private activeWorkspaceId: string | null = null;

  constructor() {
    let storedBase = isBrowser ? localStorage.getItem(BASE_URL_STORAGE_KEY) : null;
    // Normalize legacy localhost:4001 base url in local browser dev to use same-origin proxy
    if (storedBase === 'http://localhost:4001' || storedBase === 'http://127.0.0.1:4001') {
      storedBase = '';
      if (isBrowser) localStorage.removeItem(BASE_URL_STORAGE_KEY);
    }
    this.apiBaseUrl = storedBase !== null ? storedBase : DEFAULT_API_BASE;
    this.token = isBrowser ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
    this.activeWorkspaceId = isBrowser ? localStorage.getItem(WORKSPACE_STORAGE_KEY) : null;
  }

  static getInstance(): NexusApiClient {
    if (!NexusApiClient.instance) {
      NexusApiClient.instance = new NexusApiClient();
    }
    return NexusApiClient.instance;
  }

  getBaseUrl(): string {
    return this.apiBaseUrl;
  }

  setBaseUrl(url: string): void {
    this.apiBaseUrl = url.replace(/\/+$/, '');
    localStorage.setItem(BASE_URL_STORAGE_KEY, this.apiBaseUrl);
  }

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }

  getActiveWorkspaceId(): string | null {
    return this.activeWorkspaceId;
  }

  setActiveWorkspaceId(id: string | null): void {
    this.activeWorkspaceId = id;
    if (id) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.activeWorkspaceId) {
      headers['X-Workspace-Id'] = this.activeWorkspaceId;
    }
    return headers;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = this.apiBaseUrl ? `${this.apiBaseUrl}${cleanEndpoint}` : cleanEndpoint;
    const headers = { ...this.getHeaders(), ...(options.headers as Record<string, string>) };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.message) errorMessage = errorData.message;
          if (errorData.error && errorData.error !== 'Unauthorized') {
            errorMessage = `${errorData.error}: ${errorMessage}`;
          }
        } catch {
          // ignore json parse error
        }
        throw new Error(errorMessage);
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (err.name === 'TypeError') {
        // Attempt fallback to relative proxy path or 127.0.0.1
        const fallbackCandidates: string[] = [];
        if (typeof window !== 'undefined' && this.apiBaseUrl) {
          fallbackCandidates.push(cleanEndpoint);
        }
        if (this.apiBaseUrl.includes('localhost')) {
          fallbackCandidates.push(url.replace('localhost', '127.0.0.1'));
        }

        for (const candidate of fallbackCandidates) {
          try {
            const fallbackRes = await fetch(candidate, { ...options, headers });
            if (!fallbackRes.ok) {
              let errorMessage = `HTTP ${fallbackRes.status} ${fallbackRes.statusText}`;
              try {
                const errorData = await fallbackRes.json();
                if (errorData.message) errorMessage = errorData.message;
                if (errorData.error && errorData.error !== 'Unauthorized') {
                  errorMessage = `${errorData.error}: ${errorMessage}`;
                }
              } catch {
                // ignore json error
              }
              throw new Error(errorMessage);
            }
            return (await fallbackRes.json()) as T;
          } catch (candidateErr: any) {
            if (candidateErr.name !== 'TypeError') {
              throw candidateErr;
            }
          }
        }
        throw new Error(
          `Cannot reach API at ${this.apiBaseUrl || window?.location?.origin || 'http://localhost:4001'}. Ensure the backend service is running.`
        );
      }
      throw err;
    }
  }

  // ==========================================================================
  // Health & Diagnostics
  // ==========================================================================
  async checkHealth(): Promise<PlatformHealth> {
    try {
      const res = await this.request<any>('/api/v1/inference/health');
      return {
        status: res.status || 'healthy',
        provider: res.provider || 'local',
        activeModel: res.activeModel || res.model || 'qwen3.8:27b',
        localOnly: res.localOnly ?? true,
        modelsAvailable: res.modelsAvailable || [],
        offlineMode: res.offlineMode ?? false,
      };
    } catch {
      try {
        const rootHealth = await this.request<any>('/health');
        return {
          status: rootHealth.status === 'ok' ? 'healthy' : 'degraded',
          provider: 'local',
          offlineMode: rootHealth.offline?.offlineMode ?? false,
          databaseConnected: rootHealth.database?.connected ?? true,
        };
      } catch {
        return {
          status: 'offline',
        };
      }
    }
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================
  async login(email: string, password: string): Promise<{ token: string; user: any; workspaces: WorkspaceSummary[] }> {
    const res = await this.request<any>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(res.token);
    if (res.workspaces && res.workspaces.length > 0 && !this.activeWorkspaceId) {
      this.setActiveWorkspaceId(res.workspaces[0].id);
    }
    return res;
  }

  async register(data: {
    email: string;
    password: string;
    fullName?: string;
    organizationName?: string;
    workspaceName?: string;
  }): Promise<{ token: string; user: any; workspace: WorkspaceSummary }> {
    const res = await this.request<any>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.setToken(res.token);
    if (res.workspace?.id) {
      this.setActiveWorkspaceId(res.workspace.id);
    }
    return res;
  }

  async getMe(): Promise<any> {
    return this.request<any>('/api/v1/auth/me');
  }

  // ==========================================================================
  // Workspaces (Projects)
  // ==========================================================================
  async getWorkspaces(): Promise<WorkspaceSummary[]> {
    const res = await this.request<{ status: string; workspaces: WorkspaceSummary[] }>('/api/v1/workspaces');
    return res.workspaces || [];
  }

  async getWorkspace(id: string): Promise<WorkspaceSummary> {
    const res = await this.request<{ status: string; workspace: WorkspaceSummary }>(`/api/v1/workspaces/${id}`);
    return res.workspace;
  }

  async createWorkspace(name: string, slug?: string): Promise<WorkspaceSummary> {
    const res = await this.request<{ status: string; workspace: WorkspaceSummary }>('/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    });
    return res.workspace;
  }

  // ==========================================================================
  // Assistants
  // ==========================================================================
  async getAssistants(workspaceId: string): Promise<AssistantSummary[]> {
    const res = await this.request<{ status: string; assistants: AssistantSummary[] }>(
      `/api/v1/workspaces/${workspaceId}/assistants`
    );
    return res.assistants || [];
  }

  async createAssistant(
    workspaceId: string,
    data: {
      name: string;
      assistantKey: string;
      description?: string;
      systemPrompt: string;
      modelPolicy?: string;
      temperature?: number;
      publicEmbedAllowed?: boolean;
      greetingMessage?: string;
      suggestedPrompts?: string[];
      theme?: {
        primaryColor?: string;
        darkMode?: boolean;
        fontFamily?: string;
        position?: 'bottom-right' | 'bottom-left';
      };
    }
  ): Promise<AssistantSummary> {
    const res = await this.request<{ status: string; assistant: AssistantSummary }>(
      `/api/v1/workspaces/${workspaceId}/assistants`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return res.assistant;
  }

  async updateAssistant(
    workspaceId: string,
    assistantId: string,
    data: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      modelPolicy?: string;
      temperature?: number;
      publicEmbedAllowed?: boolean;
      greetingMessage?: string;
      suggestedPrompts?: string[];
      theme?: {
        primaryColor?: string;
        darkMode?: boolean;
        fontFamily?: string;
        position?: 'bottom-right' | 'bottom-left';
      };
    }
  ): Promise<AssistantSummary> {
    const res = await this.request<{ status: string; assistant: AssistantSummary }>(
      `/api/v1/workspaces/${workspaceId}/assistants/${assistantId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );
    return res.assistant;
  }

  async deleteAssistant(workspaceId: string, assistantId: string): Promise<void> {
    await this.request<{ status: string; message: string }>(
      `/api/v1/workspaces/${workspaceId}/assistants/${assistantId}`,
      {
        method: 'DELETE',
      }
    );
  }

  async getAssistantKnowledgeSpaces(
    workspaceId: string,
    assistantId: string
  ): Promise<KnowledgeSpaceSummary[]> {
    const res = await this.request<{ status: string; knowledgeSpaces: KnowledgeSpaceSummary[] }>(
      `/api/v1/workspaces/${workspaceId}/assistants/${assistantId}/knowledge-spaces`
    );
    return res.knowledgeSpaces || [];
  }

  async linkAssistantKnowledgeSpace(
    workspaceId: string,
    assistantId: string,
    knowledgeSpaceId: string
  ): Promise<void> {
    await this.request<{ status: string; message: string }>(
      `/api/v1/workspaces/${workspaceId}/assistants/${assistantId}/knowledge-spaces/${knowledgeSpaceId}`,
      {
        method: 'POST',
      }
    );
  }

  async unlinkAssistantKnowledgeSpace(
    workspaceId: string,
    assistantId: string,
    knowledgeSpaceId: string
  ): Promise<void> {
    await this.request<{ status: string; message: string }>(
      `/api/v1/workspaces/${workspaceId}/assistants/${assistantId}/knowledge-spaces/${knowledgeSpaceId}`,
      {
        method: 'DELETE',
      }
    );
  }

  async getAssistantPublicConfig(assistantId: string): Promise<any> {
    return this.request<any>(`/api/v1/assistants/${assistantId}/config`);
  }

  // ==========================================================================
  // Knowledge Spaces (Knowledge Bases)
  // ==========================================================================
  async getKnowledgeSpaces(workspaceId: string): Promise<KnowledgeSpaceSummary[]> {
    const res = await this.request<{ status: string; knowledgeSpaces: KnowledgeSpaceSummary[] }>(
      `/api/v1/workspaces/${workspaceId}/knowledge-spaces`
    );
    return res.knowledgeSpaces || [];
  }

  async createKnowledgeSpace(
    workspaceId: string,
    data: {
      name: string;
      slug: string;
      description?: string;
    }
  ): Promise<KnowledgeSpaceSummary> {
    const res = await this.request<{ status: string; knowledgeSpace: KnowledgeSpaceSummary }>(
      `/api/v1/workspaces/${workspaceId}/knowledge-spaces`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return res.knowledgeSpace;
  }

  // ==========================================================================
  // Knowledge Sources & Documents (Day 21)
  // ==========================================================================
  async getDocuments(
    knowledgeSpaceId?: string,
    workspaceId?: string
  ): Promise<DocumentSourceSummary[]> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const queryParams = new URLSearchParams();
    if (knowledgeSpaceId) queryParams.set('knowledgeSpaceId', knowledgeSpaceId);
    if (targetWorkspaceId) queryParams.set('workspaceId', targetWorkspaceId);

    const qs = queryParams.toString();
    const endpoint = `/api/v1/knowledge-sources${qs ? `?${qs}` : ''}`;
    const res = await this.request<{ status: string; sources: DocumentSourceSummary[] }>(endpoint);
    return res.sources || [];
  }

  async getDocumentDetails(sourceId: string, workspaceId?: string): Promise<DocumentSourceSummary> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const endpoint = `/api/v1/knowledge-sources/${sourceId}${
      targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : ''
    }`;
    const res = await this.request<{ status: string; source: DocumentSourceSummary }>(endpoint);
    return res.source;
  }

  async uploadDocument(
    workspaceId: string,
    knowledgeSpaceId: string,
    file: File,
    options?: {
      title?: string;
      assistantId?: string;
      metadata?: Record<string, any>;
    },
    onProgress?: (percent: number) => void
  ): Promise<DocumentSourceSummary> {
    const url = `${this.apiBaseUrl}/api/v1/workspaces/${workspaceId}/knowledge-spaces/${knowledgeSpaceId}/sources`;

    const formData = new FormData();
    formData.append('file', file);
    if (options?.title) formData.append('title', options.title);
    if (options?.assistantId) formData.append('assistantId', options.assistantId);
    if (options?.metadata) formData.append('metadata', JSON.stringify(options.metadata));

    // Use XMLHttpRequest if available for progress tracking
    if (typeof XMLHttpRequest !== 'undefined') {
      return new Promise<DocumentSourceSummary>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);

        if (this.token) {
          xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
        }
        xhr.setRequestHeader('X-Workspace-Id', workspaceId);

        if (xhr.upload && onProgress) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              onProgress(percent);
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data.source);
            } catch (e) {
              reject(new Error('Invalid response from server'));
            }
          } else {
            let errorMsg = `HTTP ${xhr.status}: ${xhr.statusText}`;
            try {
              const errData = JSON.parse(xhr.responseText);
              if (errData.message) errorMsg = errData.message;
              if (errData.error) errorMsg = `${errData.error}: ${errorMsg}`;
            } catch {
              // ignore
            }
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => {
          reject(new Error(`Network error uploading file to ${url}`));
        };

        xhr.send(formData);
      });
    }

    // Fallback to fetch
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    headers['X-Workspace-Id'] = workspaceId;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.message) errorMsg = errJson.message;
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }

    const data = await res.json();
    return data.source;
  }

  async deleteDocument(sourceId: string, workspaceId?: string): Promise<void> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const url = `/api/v1/knowledge-sources/${sourceId}${
      targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : ''
    }`;
    await this.request(url, { method: 'DELETE' });
  }

  async syncDocument(
    sourceId: string,
    workspaceId?: string
  ): Promise<{ status: string; job: any }> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const url = `/api/v1/knowledge-sources/${sourceId}/sync${
      targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : ''
    }`;
    return this.request<{ status: string; job: any }>(url, { method: 'POST' });
  }

  async getDocumentChunks(sourceId: string, workspaceId?: string): Promise<DocumentChunkSummary[]> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const url = `/api/v1/knowledge-sources/${sourceId}/chunks${
      targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : ''
    }`;
    const res = await this.request<{ status: string; chunks: DocumentChunkSummary[] }>(url);
    return res.chunks || [];
  }

  async getDocumentVersions(
    sourceId: string,
    workspaceId?: string
  ): Promise<DocumentVersionSummary[]> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const url = `/api/v1/knowledge-sources/${sourceId}/versions${
      targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : ''
    }`;
    const res = await this.request<{ status: string; versions: DocumentVersionSummary[] }>(url);
    return res.versions || [];
  }

  // ==========================================================================
  // Ingestion Jobs (Day 21)
  // ==========================================================================
  async getIngestionJobs(
    workspaceId?: string,
    sourceId?: string
  ): Promise<IngestionJobSummary[]> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const queryParams = new URLSearchParams();
    if (sourceId) queryParams.set('sourceId', sourceId);
    if (targetWorkspaceId) queryParams.set('workspaceId', targetWorkspaceId);

    const qs = queryParams.toString();
    const endpoint = `/api/v1/ingestion-jobs${qs ? `?${qs}` : ''}`;
    const res = await this.request<{ status: string; jobs: IngestionJobSummary[] }>(endpoint);
    return res.jobs || [];
  }

  async retryIngestionJob(jobId: string, workspaceId?: string): Promise<any> {
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    const endpoint = `/api/v1/ingestion-jobs/${jobId}/retry${
      targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : ''
    }`;
    return this.request<any>(endpoint, { method: 'POST' });
  }
}

export const api = NexusApiClient.getInstance();

