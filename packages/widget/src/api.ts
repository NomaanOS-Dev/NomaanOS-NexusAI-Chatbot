import type { PublicAssistantConfig, ChatMessage } from './types.js';
import type { MessageCitation } from '@nomaanos/nexus-shared-types';

export class NexusApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'NexusApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Returns or initializes a persistent anonymous guest token in browser localStorage.
 */
export function getOrCreateAnonymousToken(assistantId: string): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'anon-guest-session';
  }
  const storageKey = `nexus_anon_token_${assistantId}`;
  let token = window.localStorage.getItem(storageKey);
  if (!token) {
    token = 'anon_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    try {
      window.localStorage.setItem(storageKey, token);
    } catch {
      // Ignore localStorage errors (e.g. private mode quota)
    }
  }
  return token;
}

/**
 * Common request headers helper.
 */
function buildHeaders(authToken?: string, anonToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (anonToken) {
    headers['X-Anonymous-Session-Token'] = anonToken;
  }
  return headers;
}

/**
 * Fetches public or authenticated assistant configuration and branding.
 */
export async function fetchAssistantConfig(
  apiBaseUrl: string,
  assistantId: string,
  authToken?: string
): Promise<PublicAssistantConfig> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/assistants/${assistantId}/config`;
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(authToken),
    credentials: authToken ? 'include' : 'same-origin',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new NexusApiError(
      errorBody.message || `Failed to fetch assistant config (${res.status})`,
      res.status,
      errorBody
    );
  }

  return res.json();
}

/**
 * Initializes a new conversation for assistant.
 */
export async function createConversation(
  apiBaseUrl: string,
  assistantId: string,
  authToken?: string,
  anonToken?: string,
  metadata?: Record<string, unknown>
): Promise<{ conversationId: string; workspaceId: string; title: string }> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/conversations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(authToken, anonToken),
    credentials: authToken ? 'include' : 'same-origin',
    body: JSON.stringify({
      assistantId,
      metadata: metadata || {},
    }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new NexusApiError(
      errorBody.message || `Failed to create conversation (${res.status})`,
      res.status,
      errorBody
    );
  }

  return res.json();
}

/**
 * Fetches conversation message history.
 */
export async function fetchConversationMessages(
  apiBaseUrl: string,
  conversationId: string,
  authToken?: string,
  anonToken?: string
): Promise<ChatMessage[]> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/conversations/${conversationId}/messages`;
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(authToken, anonToken),
    credentials: authToken ? 'include' : 'same-origin',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new NexusApiError(
      errorBody.message || `Failed to fetch messages (${res.status})`,
      res.status,
      errorBody
    );
  }

  const data = await res.json();
  return data.messages || [];
}

export interface StreamCallbacks {
  onStart?: (messageId: string) => void;
  onDelta: (delta: string) => void;
  onCitations?: (citations: MessageCitation[]) => void;
  onToolStatus?: (status: { tool: string; status: string; message?: string }) => void;
  onComplete: (messageId: string) => void;
  onError: (error: Error) => void;
}

/**
 * Sends user message and streams assistant response using Server-Sent Events (SSE).
 */
export async function sendMessageStream(
  apiBaseUrl: string,
  conversationId: string,
  content: string,
  knowledgeSpaceIds: string[] | undefined,
  authToken: string | undefined,
  anonToken: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/conversations/${conversationId}/messages`;

  const headers = buildHeaders(authToken, anonToken);
  headers['Accept'] = 'text/event-stream';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      credentials: authToken ? 'include' : 'same-origin',
      signal,
      body: JSON.stringify({
        content,
        knowledgeSpaceIds,
        stream: true,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new NexusApiError(
        errorBody.message || `Message failed with status ${res.status}`,
        res.status,
        errorBody
      );
    }

    const contentType = res.headers.get('content-type') || '';

    // Handle standard JSON response fallback
    if (!contentType.includes('text/event-stream') || !res.body) {
      const data = await res.json();
      const asstMsg = data.assistantMessage;
      if (callbacks.onStart) callbacks.onStart(asstMsg.id);
      callbacks.onDelta(asstMsg.content);
      if (asstMsg.citations && callbacks.onCitations) {
        callbacks.onCitations(asstMsg.citations);
      }
      callbacks.onComplete(asstMsg.id);
      return;
    }

    // Process SSE Stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentAssistantMessageId = '';
    let isCompleted = false;

    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const normalized = buffer.replace(/\r\n/g, '\n');
      const events = normalized.split('\n\n');
      buffer = events.pop() || '';

      for (const eventBlock of events) {
        if (!eventBlock.trim()) continue;

        let eventType = 'message';
        let eventData = '';

        const lines = eventBlock.split('\n');
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6).trim();
          }
        }

        if (!eventData) continue;

        try {
          const parsed = JSON.parse(eventData);

          switch (eventType) {
            case 'message.start':
              currentAssistantMessageId = parsed.messageId;
              if (callbacks.onStart) callbacks.onStart(parsed.messageId);
              break;

            case 'text':
              if (parsed.delta) {
                callbacks.onDelta(parsed.delta);
              }
              break;

            case 'content.delta':
              // Fallback for legacy events if text event wasn't sent
              if (parsed.delta) {
                // To avoid duplicate tokens if both are sent, we check if text event wasn't already handled
                // Both are emitted by the server, but the widget can safely accept delta
              }
              break;

            case 'citation':
            case 'citations':
              if (parsed.citations && callbacks.onCitations) {
                callbacks.onCitations(parsed.citations);
              } else if (parsed.citation && callbacks.onCitations) {
                callbacks.onCitations([parsed.citation]);
              }
              break;

            case 'tool_status':
              if (callbacks.onToolStatus) {
                callbacks.onToolStatus(parsed);
              }
              break;

            case 'completion':
            case 'message.complete':
              if (!isCompleted) {
                isCompleted = true;
                callbacks.onComplete(parsed.messageId || currentAssistantMessageId);
              }
              break;

            case 'error':
              callbacks.onError(new Error(parsed.message || parsed.error || 'Server stream error'));
              break;

            default:
              break;
          }
        } catch {
          // If non-JSON chunk, ignore
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted) {
      // User aborted generation cleanly
      return;
    }
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Submits feedback rating (positive/negative) and optional comment for an assistant message.
 */
export async function submitMessageFeedback(
  apiBaseUrl: string,
  conversationId: string,
  messageId: string,
  rating: 'positive' | 'negative' | 'thumbs_up' | 'thumbs_down',
  comment?: string,
  authToken?: string,
  anonToken?: string
): Promise<{ id: string; rating: string; comment?: string }> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/conversations/${conversationId}/messages/${messageId}/feedback`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(authToken, anonToken),
    credentials: authToken ? 'include' : 'same-origin',
    body: JSON.stringify({ rating, comment }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new NexusApiError(
      errorBody.message || `Failed to submit feedback (${res.status})`,
      res.status,
      errorBody
    );
  }

  const data = await res.json();
  return data.feedback;
}

