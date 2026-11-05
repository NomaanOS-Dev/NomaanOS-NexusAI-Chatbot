import type { AssistantTheme, MessageCitation } from '@nomaanos/nexus-shared-types';

export interface WidgetTheme {
  primaryColor: string;
  fontFamily: string;
  darkMode: boolean;
  brandLogoUrl?: string;
  backgroundColor?: string;
  textColor?: string;
  bubbleColor?: string;
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

export interface MessageFeedback {
  id?: string;
  rating: 'positive' | 'negative' | 'thumbs_up' | 'thumbs_down';
  comment?: string | null;
  createdAt?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  citations?: MessageCitation[];
  createdAt: string;
  isStreaming?: boolean;
  finishReason?: string;
  feedback?: MessageFeedback | null;
  toolStatus?: {
    tool: string;
    status: string;
    message?: string;
  };
}

export interface KnowledgeSpaceOption {
  id: string;
  name: string;
  slug: string;
}

export interface NexusChatWidgetProps {
  /** Target assistant ID UUID */
  assistantId: string;
  /** Optional existing conversation ID to restore */
  conversationId?: string;
  /** Base URL for Nexus AI API (defaults to current origin or http://localhost:4001) */
  apiBaseUrl?: string;
  /** Optional JWT or session Bearer token for authenticated assistant mode */
  authToken?: string;
  /** Pre-selected or locked knowledge space ID */
  knowledgeSpaceId?: string;
  /** Initial open state of chat window */
  initialOpen?: boolean;
  /** Host application identifier (e.g. 'nomaanos-sentinel') */
  hostApplication?: string;
  /** Custom theme overrides for assistant */
  themeOverrides?: Partial<WidgetTheme>;
  /** Widget positioning */
  position?: 'bottom-right' | 'bottom-left';
  /** Custom title override */
  title?: string;
  /** Callback when user sends message */
  onMessageSent?: (content: string) => void;
  /** Callback when assistant message is fully received */
  onResponseReceived?: (content: string) => void;
  /** Callback when connection or message error occurs */
  onError?: (error: Error) => void;
  /** Callback when a new conversation is initialized */
  onConversationCreated?: (conversationId: string) => void;
  /** Callback when message feedback is submitted */
  onFeedbackSubmitted?: (messageId: string, rating: 'positive' | 'negative') => void;
  /** Custom Z-index for overlay launcher */
  zIndex?: number;
}
