import React, { useState, useEffect, useRef } from 'react';
import type { NexusChatWidgetProps, PublicAssistantConfig, ChatMessage, WidgetTheme } from './types.js';
import {
  fetchAssistantConfig,
  createConversation,
  fetchConversationMessages,
  sendMessageStream,
  submitMessageFeedback,
  getOrCreateAnonymousToken,
  NexusApiError,
} from './api.js';
import {
  ChatIcon,
  CloseIcon,
  MinimizeIcon,
  RefreshIcon,
  SendIcon,
  CitationIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  StopIcon,
} from './components/Icons.js';
import { MarkdownView } from './components/MarkdownView.js';
import './widget.css';

export const NexusChatWidget: React.FC<NexusChatWidgetProps> = ({
  assistantId,
  conversationId: propConversationId,
  apiBaseUrl = 'http://localhost:4001',
  authToken,
  knowledgeSpaceId,
  initialOpen = false,
  hostApplication = 'nomaanos-web',
  themeOverrides,
  position = 'bottom-right',
  title,
  onMessageSent,
  onResponseReceived,
  onError,
  onConversationCreated,
  onFeedbackSubmitted,
  zIndex = 9999,
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [config, setConfig] = useState<PublicAssistantConfig | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(propConversationId || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputContent, setInputContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeToolStatus, setActiveToolStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [expandedCitationId, setExpandedCitationId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isLocalConversationRef = useRef(false);
  const activeAssistantMessageIdRef = useRef<string | null>(null);

  // Anonymous guest session token for public mode
  const anonToken = useRef<string>('');

  useEffect(() => {
    anonToken.current = getOrCreateAnonymousToken(assistantId);
  }, [assistantId]);

  // Load Assistant Configuration
  useEffect(() => {
    let isMounted = true;
    async function loadConfig() {
      try {
        setErrorMsg(null);
        setIsSessionExpired(false);
        const data = await fetchAssistantConfig(apiBaseUrl, assistantId, authToken);
        if (isMounted) {
          setConfig(data);
        }
      } catch (err: any) {
        if (isMounted) {
          if (err instanceof NexusApiError && err.statusCode === 401) {
            setIsSessionExpired(true);
            setErrorMsg('Your session has expired. Please sign in again.');
          } else {
            setErrorMsg(err.message || 'Failed to connect to Nexus AI Assistant.');
          }
          if (onError) onError(err);
        }
      }
    }
    loadConfig();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, assistantId, authToken]);

  // Handle external propConversationId updates
  useEffect(() => {
    if (propConversationId && propConversationId !== conversationId) {
      isLocalConversationRef.current = false;
      setConversationId(propConversationId);
    }
  }, [propConversationId]);

  // Restore conversation history if conversationId exists
  useEffect(() => {
    let isMounted = true;
    async function loadHistory() {
      const activeConvId = conversationId || propConversationId;
      if (!activeConvId) return;

      // Do NOT clobber active streaming messages if conversation was created in this session
      if (isLocalConversationRef.current || isGenerating) return;

      try {
        const history = await fetchConversationMessages(
          apiBaseUrl,
          activeConvId,
          authToken,
          anonToken.current
        );
        if (isMounted && history.length > 0) {
          setMessages(history);
        }
      } catch {
        // Fallback: start clean if previous history retrieval fails
      }
    }
    if (isOpen) {
      loadHistory();
    }
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, conversationId, propConversationId, authToken, isOpen, isGenerating]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isGenerating, isOpen, activeToolStatus]);

  // Dynamic Theme Resolution
  const theme: WidgetTheme = {
    primaryColor: themeOverrides?.primaryColor || config?.theme?.primaryColor || '#3b82f6',
    fontFamily: themeOverrides?.fontFamily || config?.theme?.fontFamily || 'inherit',
    darkMode: themeOverrides?.darkMode !== undefined ? themeOverrides.darkMode : !!config?.theme?.darkMode,
    brandLogoUrl: themeOverrides?.brandLogoUrl || config?.theme?.brandLogoUrl,
  };

  const containerStyle = {
    '--nexus-primary': theme.primaryColor,
    '--nexus-font': theme.fontFamily,
    zIndex,
  } as React.CSSProperties;

  // Initialize or Reset Conversation
  const handleStartNewConversation = async () => {
    if (isGenerating && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
    isLocalConversationRef.current = false;
    activeAssistantMessageIdRef.current = null;
    setMessages([]);
    setErrorMsg(null);
    setConversationId(null);
    setActiveToolStatus(null);
  };

  // Cancel generation in progress
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setActiveToolStatus(null);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false, finishReason: 'cancelled' } : msg
      )
    );
  };

  // Submit Feedback on Assistant Message
  const handleFeedback = async (messageId: string, rating: 'positive' | 'negative') => {
    if (!conversationId) return;

    // Optimistic UI update
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, feedback: { rating } } : msg
      )
    );

    try {
      await submitMessageFeedback(
        apiBaseUrl,
        conversationId,
        messageId,
        rating,
        undefined,
        authToken,
        anonToken.current
      );
      if (onFeedbackSubmitted) onFeedbackSubmitted(messageId, rating);
    } catch (err: any) {
      // Revert if error
      setErrorMsg(err.message || 'Failed to submit feedback.');
    }
  };

  // Send Message
  const handleSendMessage = async (textToSend?: string) => {
    const rawContent = (textToSend || inputContent).trim();
    if (!rawContent || isGenerating) return;

    setInputContent('');
    setErrorMsg(null);
    setActiveToolStatus(null);

    // Optimistically append user message
    const userMessage: ChatMessage = {
      id: 'usr_' + Date.now(),
      role: 'user',
      content: rawContent,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    if (onMessageSent) onMessageSent(rawContent);

    setIsGenerating(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // 1. Ensure conversation exists
      let activeConvId = conversationId;
      if (!activeConvId) {
        isLocalConversationRef.current = true;
        const conv = await createConversation(
          apiBaseUrl,
          assistantId,
          authToken,
          anonToken.current,
          { hostApplication, referrer: typeof window !== 'undefined' ? window.location.href : '' }
        );
        activeConvId = conv.conversationId;
        setConversationId(activeConvId);
        if (onConversationCreated) onConversationCreated(activeConvId);
      }

      // Placeholder for streaming assistant response
      const asstTempId = 'asst_' + Date.now();
      activeAssistantMessageIdRef.current = asstTempId;

      setMessages((prev) => [
        ...prev,
        {
          id: asstTempId,
          role: 'assistant',
          content: '',
          citations: [],
          createdAt: new Date().toISOString(),
          isStreaming: true,
        },
      ]);

      const spaceIds = knowledgeSpaceId ? [knowledgeSpaceId] : undefined;

      await sendMessageStream(
        apiBaseUrl,
        activeConvId,
        rawContent,
        spaceIds,
        authToken,
        anonToken.current,
        {
          onStart: (messageId: string) => {
            activeAssistantMessageIdRef.current = messageId;
            setMessages((prev) =>
              prev.map((msg) => (msg.id === asstTempId ? { ...msg, id: messageId } : msg))
            );
          },
          onDelta: (delta: string) => {
            const targetId = activeAssistantMessageIdRef.current;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === targetId || msg.id === asstTempId || msg.isStreaming
                  ? { ...msg, content: msg.content + delta }
                  : msg
              )
            );
          },
          onToolStatus: (status) => {
            setActiveToolStatus(`${status.tool}: ${status.status}`);
          },
          onCitations: (citations) => {
            const targetId = activeAssistantMessageIdRef.current;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === targetId || msg.id === asstTempId || msg.isStreaming ? { ...msg, citations } : msg
              )
            );
          },
          onComplete: (finalMessageId) => {
            const targetId = activeAssistantMessageIdRef.current;
            setMessages((prev) => {
              const updated = prev.map((msg) =>
                msg.id === targetId || msg.id === asstTempId || msg.isStreaming
                  ? { ...msg, id: finalMessageId || msg.id, isStreaming: false, finishReason: 'stop' }
                  : msg
              );
              if (onResponseReceived) {
                const completed = updated.find((m) => m.id === targetId || m.id === finalMessageId);
                if (completed) onResponseReceived(completed.content);
              }
              return updated;
            });
            setIsGenerating(false);
            setActiveToolStatus(null);
            abortControllerRef.current = null;
            activeAssistantMessageIdRef.current = null;
          },
          onError: (err) => {
            if (err instanceof NexusApiError && err.statusCode === 401) {
              setIsSessionExpired(true);
              setErrorMsg('Session expired. Please sign in again.');
            } else {
              setErrorMsg(err.message || 'Stream connection error.');
            }
            setIsGenerating(false);
            setActiveToolStatus(null);
            abortControllerRef.current = null;
            activeAssistantMessageIdRef.current = null;
            if (onError) onError(err);
          },
        },
        abortController.signal
      );
    } catch (err: any) {
      if (abortController.signal.aborted) {
        return; // User clicked Stop
      }
      if (err instanceof NexusApiError && err.statusCode === 401) {
        setIsSessionExpired(true);
        setErrorMsg('Session expired. Please sign in again.');
      } else {
        setErrorMsg(err.message || 'Failed to deliver message.');
      }
      setIsGenerating(false);
      setActiveToolStatus(null);
      abortControllerRef.current = null;
      activeAssistantMessageIdRef.current = null;
      if (onError) onError(err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const assistantName = title || config?.name || 'Nexus AI Assistant';
  const greeting = config?.greetingMessage || 'Hello! How can I help you today?';
  const suggestedPrompts = config?.suggestedPrompts || [];

  return (
    <div
      className={`nexus-chat-container nexus-position-${position} ${
        theme.darkMode ? 'nexus-dark' : ''
      }`}
      style={containerStyle}
    >
      {/* 1. Floating Launcher Button */}
      {!isOpen && (
        <button
          type="button"
          className="nexus-launcher-btn"
          aria-label="Open Nexus AI Chat"
          onClick={() => setIsOpen(true)}
        >
          <ChatIcon className="nexus-launcher-icon" />
          {suggestedPrompts.length > 0 && <span className="nexus-launcher-badge" />}
        </button>
      )}

      {/* 2. Interactive Chat Window */}
      {isOpen && (
        <div className="nexus-window" role="dialog" aria-modal="false">
          {/* Header */}
          <div className="nexus-header">
            <div className="nexus-header-left">
              {config?.avatarUrl ? (
                <img src={config.avatarUrl} alt={assistantName} className="nexus-avatar" />
              ) : (
                <div className="nexus-avatar">{assistantName.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="nexus-header-info">
                <div className="nexus-header-title">{assistantName}</div>
                <div className="nexus-header-status">
                  <span className="nexus-status-dot" />
                  <span>Online • Nexus AI</span>
                </div>
              </div>
            </div>

            <div className="nexus-header-actions">
              <button
                type="button"
                className="nexus-icon-btn"
                title="Start New Conversation"
                onClick={handleStartNewConversation}
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                className="nexus-icon-btn"
                title="Minimize Chat"
                onClick={() => setIsOpen(false)}
              >
                <MinimizeIcon />
              </button>
              <button
                type="button"
                className="nexus-icon-btn"
                title="Close Chat"
                onClick={() => {
                  if (isGenerating) handleCancelGeneration();
                  setIsOpen(false);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* Optional Knowledge Space Indicator */}
          {knowledgeSpaceId && (
            <div className="nexus-space-bar">
              <span>Scoped Knowledge Space:</span>
              <span className="nexus-space-tag">Verified Domain</span>
            </div>
          )}

          {/* Messages Scroll Area */}
          <div className="nexus-messages">
            {/* Greeting & Suggested Prompts Card */}
            {messages.length === 0 && (
              <div className="nexus-greeting-card">
                <div className="nexus-greeting-text">{greeting}</div>
                {suggestedPrompts.length > 0 && (
                  <div className="nexus-prompts-container">
                    {suggestedPrompts.map((prompt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="nexus-prompt-pill"
                        onClick={() => handleSendMessage(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Conversation Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`nexus-message-row ${
                  msg.role === 'user' ? 'nexus-row-user' : 'nexus-row-assistant'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="nexus-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                    {config?.avatarUrl ? (
                      <img
                        src={config.avatarUrl}
                        alt="Bot"
                        style={{ width: '100%', height: '100%', borderRadius: '50%' }}
                      />
                    ) : (
                      'AI'
                    )}
                  </div>
                )}

                <div
                  className={`nexus-bubble ${
                    msg.role === 'user' ? 'nexus-bubble-user' : 'nexus-bubble-assistant'
                  }`}
                >
                  <MarkdownView content={msg.content} />

                  {/* Evidence Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="nexus-citations">
                      {msg.citations.map((c) => {
                        const citKey = `${msg.id}-${c.citationIndex}`;
                        const isExpanded = expandedCitationId === citKey;
                        return (
                          <div key={c.citationIndex} className="nexus-citation-item">
                            <button
                              type="button"
                              className="nexus-citation-badge"
                              onClick={() =>
                                setExpandedCitationId(isExpanded ? null : citKey)
                              }
                            >
                              <CitationIcon style={{ width: 13, height: 13 }} />
                              <span>
                                [{c.citationIndex}] {c.sourceTitle}
                                {c.versionNumber ? ` (v${c.versionNumber})` : ''}
                                {c.pageNumber ? ` p.${c.pageNumber}` : ''}
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="nexus-citation-excerpt">
                                <div className="nexus-citation-meta">
                                  {c.sectionPath && <span className="nexus-cit-tag">§ {c.sectionPath}</span>}
                                  {c.pageNumber && <span className="nexus-cit-tag">Page {c.pageNumber}</span>}
                                  {c.versionNumber && <span className="nexus-cit-tag">v{c.versionNumber}</span>}
                                  {c.validationStatus && (
                                    <span
                                      className={`nexus-cit-tag ${
                                        c.validationStatus === 'verified' ? 'nexus-cit-verified' : ''
                                      }`}
                                    >
                                      {c.validationStatus === 'verified' ? '✓ Verified' : c.validationStatus}
                                    </span>
                                  )}
                                  {c.sourceUrl && (
                                    <a
                                      href={`${apiBaseUrl}${c.sourceUrl}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="nexus-cit-link"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Source ↗
                                    </a>
                                  )}
                                </div>
                                <div className="nexus-cit-quote">&ldquo;{c.excerpt}&rdquo;</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Message Action Footer: Feedback & Timestamp */}
                  <div className="nexus-msg-footer">
                    {msg.role === 'assistant' && !msg.isStreaming ? (
                      <div className="nexus-feedback-actions" aria-label="Message feedback">
                        <button
                          type="button"
                          className={`nexus-feedback-btn ${
                            msg.feedback?.rating === 'positive' || msg.feedback?.rating === 'thumbs_up'
                              ? 'active'
                              : ''
                          }`}
                          title="Helpful response"
                          onClick={() => handleFeedback(msg.id, 'positive')}
                        >
                          <ThumbsUpIcon style={{ width: 14, height: 14 }} />
                        </button>
                        <button
                          type="button"
                          className={`nexus-feedback-btn ${
                            msg.feedback?.rating === 'negative' || msg.feedback?.rating === 'thumbs_down'
                              ? 'active'
                              : ''
                          }`}
                          title="Unhelpful response"
                          onClick={() => handleFeedback(msg.id, 'negative')}
                        >
                          <ThumbsDownIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    ) : (
                      <div />
                    )}

                    <div className="nexus-msg-time">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Active Tool Execution Status */}
            {activeToolStatus && (
              <div className="nexus-tool-badge">
                <span>⚙️ {activeToolStatus}</span>
              </div>
            )}

            {/* Typing Animation while awaiting first token */}
            {isGenerating &&
              messages.length > 0 &&
              messages[messages.length - 1].role === 'assistant' &&
              messages[messages.length - 1].content === '' && (
                <div className="nexus-typing">
                  <span className="nexus-dot" />
                  <span className="nexus-dot" />
                  <span className="nexus-dot" />
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="nexus-error-banner">
              <span>{errorMsg}</span>
              {!isSessionExpired && (
                <button
                  type="button"
                  className="nexus-retry-btn"
                  onClick={() => handleSendMessage()}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Input Area */}
          <div className="nexus-input-area">
            <textarea
              ref={textareaRef}
              rows={1}
              className="nexus-textarea"
              placeholder="Ask a question or request assistance..."
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
            />

            {/* Stop button when generating, Send button otherwise */}
            {isGenerating ? (
              <button
                type="button"
                className="nexus-stop-btn"
                title="Stop generation"
                onClick={handleCancelGeneration}
                aria-label="Stop Generation"
              >
                <StopIcon style={{ width: 16, height: 16 }} />
              </button>
            ) : (
              <button
                type="button"
                className="nexus-send-btn"
                disabled={!inputContent.trim() || isGenerating}
                onClick={() => handleSendMessage()}
                aria-label="Send Message"
              >
                <SendIcon style={{ width: 18, height: 18 }} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
