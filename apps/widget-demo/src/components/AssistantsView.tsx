import React, { useState, useEffect, useCallback } from 'react';
import { NexusChatWidget } from '@nomaanos/nexus-widget';
import '@nomaanos/nexus-widget/style.css';
import { AssistantSummary, KnowledgeSpaceSummary, WorkspaceSummary, ModelPolicy } from '../types';
import { api } from '../services/api';

interface AssistantsViewProps {
  assistants: AssistantSummary[];
  knowledgeSpaces: KnowledgeSpaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  workspaces?: WorkspaceSummary[];
  onSelectWorkspace?: (id: string) => void;
  onCreateAssistant: (data: any) => Promise<void>;
  onUpdateAssistant?: (assistantId: string, data: any) => Promise<void>;
  onDeleteAssistant?: (assistantId: string) => Promise<void>;
  onSelectForWidgetConfig: (assistant: AssistantSummary) => void;
  onSelectForPlayground: (assistant: AssistantSummary) => void;
  loading: boolean;
}

const PRESET_COLORS = [
  { label: 'Sentinel Cyan', hex: '#06b6d4' },
  { label: 'Nexus Blue', hex: '#3b82f6' },
  { label: 'Emerald Green', hex: '#10b981' },
  { label: 'Violet AI', hex: '#8b5cf6' },
  { label: 'Amber Alert', hex: '#f59e0b' },
  { label: 'Rose Incident', hex: '#ef4444' },
];

export const AssistantsView: React.FC<AssistantsViewProps> = ({
  assistants,
  knowledgeSpaces,
  activeWorkspace,
  workspaces,
  onSelectWorkspace,
  onCreateAssistant,
  onUpdateAssistant,
  onDeleteAssistant,
  onSelectForWidgetConfig,
  onSelectForPlayground,
  loading,
}) => {
  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalAssistant, setEditModalAssistant] = useState<AssistantSummary | null>(null);
  const [spacesModalAssistant, setSpacesModalAssistant] = useState<AssistantSummary | null>(null);
  const [previewAssistant, setPreviewAssistant] = useState<AssistantSummary | null>(null);

  // Assistant associations cache: assistantId -> KnowledgeSpaceSummary[]
  const [assistantSpaces, setAssistantSpaces] = useState<Record<string, KnowledgeSpaceSummary[]>>({});
  const [spacesLoading, setSpacesLoading] = useState(false);

  // Form states for Create / Edit
  const [name, setName] = useState('');
  const [assistantKey, setAssistantKey] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a helpful, enterprise-grade technical documentation copilot. Answer inquiries accurately using verified retrieved context.'
  );
  const [modelPolicy, setModelPolicy] = useState<ModelPolicy>('local-only');
  const [temperature, setTemperature] = useState(0.2);
  const [publicEmbedAllowed, setPublicEmbedAllowed] = useState(true);
  const [greetingMessage, setGreetingMessage] = useState('Greetings! How can I assist you with this platform today?');
  const [primaryColor, setPrimaryColor] = useState('#06b6d4');
  const [darkMode, setDarkMode] = useState(true);
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');
  const [promptsText, setPromptsText] = useState('How do I get started?\nWhat are the security runbooks?');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch knowledge space links for all assistants in active workspace
  const fetchAllAssistantSpaces = useCallback(async () => {
    if (!activeWorkspace || assistants.length === 0) return;
    const map: Record<string, KnowledgeSpaceSummary[]> = {};
    for (const asst of assistants) {
      try {
        const spaces = await api.getAssistantKnowledgeSpaces(activeWorkspace.id, asst.id);
        map[asst.id] = spaces;
      } catch (err) {
        // ignore missing links
      }
    }
    setAssistantSpaces(map);
  }, [activeWorkspace, assistants]);

  useEffect(() => {
    fetchAllAssistantSpaces();
  }, [fetchAllAssistantSpaces]);

  // Open Edit Modal with prepopulated values
  const handleOpenEdit = (asst: AssistantSummary) => {
    setEditModalAssistant(asst);
    setName(asst.name);
    setAssistantKey(asst.assistant_key);
    setDescription(asst.description || '');
    setSystemPrompt(asst.system_prompt || '');
    setModelPolicy(asst.model_policy);
    setTemperature(asst.temperature);
    setPublicEmbedAllowed(asst.public_embed_allowed);
    setGreetingMessage(asst.greeting_message || 'Greetings! How can I assist you today?');
    setPrimaryColor(asst.theme?.primaryColor || '#06b6d4');
    setDarkMode(asst.theme?.darkMode !== false);
    setPosition((asst.theme?.position as any) || 'bottom-right');
    setPromptsText((asst.suggested_prompts || []).join('\n'));
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Open Create Modal with defaults
  const handleOpenCreate = () => {
    setName('');
    setAssistantKey('');
    setDescription('');
    setSystemPrompt(
      'You are a helpful, enterprise-grade technical documentation copilot. Answer inquiries accurately using verified retrieved context.'
    );
    setModelPolicy('local-only');
    setTemperature(0.2);
    setPublicEmbedAllowed(true);
    setGreetingMessage('Greetings! How can I assist you today?');
    setPrimaryColor('#06b6d4');
    setDarkMode(true);
    setPosition('bottom-right');
    setPromptsText('How do I get started?\nWhat are the security runbooks?');
    setErrorMessage(null);
    setSuccessMessage(null);
    setCreateModalOpen(true);
  };

  // Submit Create Assistant
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Assistant name is required.');
      return;
    }
    const safeKey = assistantKey.trim() || name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const prompts = promptsText.split('\n').map((p) => p.trim()).filter(Boolean);

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onCreateAssistant({
        name: name.trim(),
        assistantKey: safeKey,
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
        modelPolicy,
        temperature,
        publicEmbedAllowed,
        greetingMessage: greetingMessage.trim() || undefined,
        suggestedPrompts: prompts,
        theme: {
          primaryColor,
          darkMode,
          position,
        },
      });

      setSuccessMessage(`Assistant "${name}" created successfully!`);
      setTimeout(() => {
        setCreateModalOpen(false);
        setSuccessMessage(null);
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create assistant.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Edit Assistant
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalAssistant || !activeWorkspace) return;
    if (!name.trim()) {
      setErrorMessage('Assistant name is required.');
      return;
    }
    const prompts = promptsText.split('\n').map((p) => p.trim()).filter(Boolean);

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const updateData = {
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
        modelPolicy,
        temperature,
        publicEmbedAllowed,
        greetingMessage: greetingMessage.trim() || undefined,
        suggestedPrompts: prompts,
        theme: {
          primaryColor,
          darkMode,
          position,
        },
      };

      if (onUpdateAssistant) {
        await onUpdateAssistant(editModalAssistant.id, updateData);
      } else {
        await api.updateAssistant(activeWorkspace.id, editModalAssistant.id, updateData);
      }

      setSuccessMessage(`Assistant "${name}" updated successfully!`);
      setTimeout(() => {
        setEditModalAssistant(null);
        setSuccessMessage(null);
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update assistant.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Assistant
  const handleDelete = async (asst: AssistantSummary) => {
    if (!activeWorkspace) return;
    const confirmDel = window.confirm(`Are you sure you want to delete assistant "${asst.name}"?`);
    if (!confirmDel) return;

    try {
      if (onDeleteAssistant) {
        await onDeleteAssistant(asst.id);
      } else {
        await api.deleteAssistant(activeWorkspace.id, asst.id);
      }
      await fetchAllAssistantSpaces();
    } catch (err: any) {
      alert(err.message || 'Failed to delete assistant.');
    }
  };

  // Toggle Knowledge Space link
  const handleToggleSpaceLink = async (assistantId: string, spaceId: string, isLinked: boolean) => {
    if (!activeWorkspace) return;
    setSpacesLoading(true);
    try {
      if (isLinked) {
        await api.unlinkAssistantKnowledgeSpace(activeWorkspace.id, assistantId, spaceId);
      } else {
        await api.linkAssistantKnowledgeSpace(activeWorkspace.id, assistantId, spaceId);
      }
      // Refresh spaces
      const updated = await api.getAssistantKnowledgeSpaces(activeWorkspace.id, assistantId);
      setAssistantSpaces((prev) => ({ ...prev, [assistantId]: updated }));
    } catch (err: any) {
      alert(err.message || 'Failed to update knowledge space link.');
    } finally {
      setSpacesLoading(false);
    }
  };

  const getPolicyColor = (policy: ModelPolicy) => {
    switch (policy) {
      case 'local-only':
        return '#10b981';
      case 'cloud-preferred':
        return '#3b82f6';
      case 'hybrid':
        return '#8b5cf6';
      case 'cloud-only':
        return '#f59e0b';
    }
  };

  return (
    <div className="nexus-view-container">
      {/* Header */}
      <div className="nexus-page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="nexus-page-title">Configured Assistants</h1>
            {activeWorkspace && (
              <span className="nexus-badge status-healthy" style={{ fontSize: 13, padding: '4px 10px' }}>
                📁 Project: {activeWorkspace.name}
              </span>
            )}
          </div>
          <p className="nexus-page-subtitle">
            Configure project-specific AI personas, link authorized knowledge bases, customize widget themes, and preview embeds.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {workspaces && workspaces.length > 1 && onSelectWorkspace && (
            <select
              className="nexus-input"
              style={{ width: 'auto', background: '#1e293b', color: '#f8fafc' }}
              value={activeWorkspace?.id || ''}
              onChange={(e) => onSelectWorkspace(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  Project: {ws.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="nexus-btn-primary"
            onClick={handleOpenCreate}
            disabled={!activeWorkspace}
          >
            <span>➕</span> New Assistant
          </button>
        </div>
      </div>

      {!activeWorkspace ? (
        <div className="nexus-empty-state">
          <p>Please select an active project to view and manage assistants.</p>
        </div>
      ) : loading ? (
        <div className="nexus-loading-state">
          <div className="nexus-spinner" />
          <p>Loading assistants for project {activeWorkspace.name}...</p>
        </div>
      ) : assistants.length === 0 ? (
        <div className="nexus-empty-state">
          <span style={{ fontSize: 42 }}>🤖</span>
          <h3>No Assistants Configured in this Project</h3>
          <p>
            Create an assistant persona and link your project's knowledge spaces to deploy a customized SaaS chatbot.
          </p>
          <button type="button" className="nexus-btn-primary" onClick={handleOpenCreate}>
            Create Assistant
          </button>
        </div>
      ) : (
        <div className="nexus-assistants-grid">
          {assistants.map((asst) => {
            const linkedSpaces = assistantSpaces[asst.id] || [];
            const asstTheme = asst.theme || {};
            const themeColor = asstTheme.primaryColor || '#06b6d4';

            return (
              <div key={asst.id} className="nexus-card">
                {/* Header */}
                <div className="nexus-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        backgroundColor: themeColor,
                        boxShadow: `0 0 8px ${themeColor}`,
                      }}
                      title={`Primary Color: ${themeColor}`}
                    />
                    <div>
                      <h3 className="nexus-card-title">{asst.name}</h3>
                      <code style={{ fontSize: 11, color: '#94a3b8' }}>key: {asst.assistant_key}</code>
                    </div>
                  </div>
                  <span
                    className="nexus-badge"
                    style={{
                      backgroundColor: `${getPolicyColor(asst.model_policy)}20`,
                      color: getPolicyColor(asst.model_policy),
                      border: `1px solid ${getPolicyColor(asst.model_policy)}60`,
                    }}
                  >
                    {asst.model_policy}
                  </span>
                </div>

                <p className="nexus-card-description" style={{ minHeight: 36 }}>
                  {asst.description || 'General platform technical documentation assistant.'}
                </p>

                {/* Details List */}
                <div className="nexus-detail-list">
                  <div className="nexus-detail-item">
                    <span className="nexus-detail-label">Assistant UUID:</span>
                    <code className="nexus-detail-code">{asst.id.slice(0, 18)}...</code>
                  </div>
                  <div className="nexus-detail-item">
                    <span className="nexus-detail-label">Widget Theme:</span>
                    <span style={{ fontSize: 12, color: asstTheme.darkMode !== false ? '#38bdf8' : '#cbd5e1' }}>
                      {asstTheme.darkMode !== false ? '🌙 Dark' : '☀️ Light'} ({asstTheme.position || 'bottom-right'})
                    </span>
                  </div>
                  <div className="nexus-detail-item">
                    <span className="nexus-detail-label">Public Embed:</span>
                    <span style={{ color: asst.public_embed_allowed ? '#10b981' : '#f59e0b', fontSize: 12 }}>
                      {asst.public_embed_allowed ? '✓ Public Widget Allowed' : '🔒 Auth Required'}
                    </span>
                  </div>
                </div>

                {/* Associated Knowledge Spaces */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#f8fafc' }}>
                      📚 Linked Knowledge Bases ({linkedSpaces.length}):
                    </span>
                    <button
                      type="button"
                      className="nexus-btn-ghost"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setSpacesModalAssistant(asst)}
                      title="Link or unlink knowledge bases in this project"
                    >
                      ⚙️ Manage Links
                    </button>
                  </div>

                  {linkedSpaces.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#f59e0b', fontStyle: 'italic' }}>
                      ⚠️ No knowledge bases linked. Assistant will use general system instructions.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {linkedSpaces.map((space) => (
                        <span key={space.id} className="nexus-badge status-healthy" style={{ fontSize: 11 }}>
                          📖 {space.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Suggested Prompts */}
                {asst.suggested_prompts && asst.suggested_prompts.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Suggested Prompts:</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {asst.suggested_prompts.slice(0, 3).map((prompt, idx) => (
                        <span key={idx} className="nexus-tag" style={{ fontSize: 11 }}>
                          💬 {prompt}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Card Actions */}
                <div className="nexus-card-footer-actions" style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', gap: 6, width: '100%', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="nexus-btn-primary"
                      style={{ flex: 1, minWidth: 110 }}
                      onClick={() => onSelectForWidgetConfig(asst)}
                      title="Configure embed code and widget installation"
                    >
                      📦 Install & Code
                    </button>
                    <button
                      type="button"
                      className="nexus-btn-secondary"
                      style={{ padding: '6px 10px' }}
                      onClick={() => setPreviewAssistant(asst)}
                      title="Preview live widget"
                    >
                      👁️ Preview
                    </button>
                    <button
                      type="button"
                      className="nexus-btn-ghost"
                      style={{ padding: '6px 10px' }}
                      onClick={() => handleOpenEdit(asst)}
                      title="Edit Assistant Settings"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      type="button"
                      className="nexus-btn-ghost"
                      style={{ padding: '6px 10px', color: '#f87171' }}
                      onClick={() => handleDelete(asst)}
                      title="Delete Assistant"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create or Edit Assistant */}
      {(createModalOpen || editModalAssistant) && (
        <div
          className="nexus-modal-overlay"
          onClick={() => {
            setCreateModalOpen(false);
            setEditModalAssistant(null);
          }}
        >
          <div className="nexus-modal-card" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="nexus-modal-header">
              <h3>{editModalAssistant ? `Edit Assistant: ${editModalAssistant.name}` : 'Create New Assistant'}</h3>
              <button
                type="button"
                className="nexus-close-btn"
                onClick={() => {
                  setCreateModalOpen(false);
                  setEditModalAssistant(null);
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={editModalAssistant ? handleEditSubmit : handleCreateSubmit}>
              {errorMessage && <div className="nexus-form-error">{errorMessage}</div>}
              {successMessage && <div className="nexus-form-success">{successMessage}</div>}

              <div className="nexus-grid-two-col" style={{ gap: 12 }}>
                <div className="nexus-form-group">
                  <label className="nexus-form-label">Assistant Name *</label>
                  <input
                    type="text"
                    className="nexus-input"
                    placeholder="e.g. Sentinel Cyber Copilot, Docs Assistant"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isSubmitting}
                    required
                  />
                </div>

                {!editModalAssistant && (
                  <div className="nexus-form-group">
                    <label className="nexus-form-label">Assistant Key (Slug)</label>
                    <input
                      type="text"
                      className="nexus-input"
                      placeholder="e.g. cyber-copilot"
                      value={assistantKey}
                      onChange={(e) => setAssistantKey(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>

              <div className="nexus-form-group">
                <label className="nexus-form-label">Description (optional)</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. Specialized chatbot for incident triage & security telemetry"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Theme & Branding Options */}
              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#38bdf8', marginBottom: 10 }}>
                  🎨 Widget Theme & Branding Options
                </div>

                <div className="nexus-grid-two-col" style={{ gap: 12, marginBottom: 10 }}>
                  <div className="nexus-form-group" style={{ margin: 0 }}>
                    <label className="nexus-form-label">Primary Brand Color</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        style={{
                          width: 40,
                          height: 36,
                          padding: 2,
                          borderRadius: 6,
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      />
                      <input
                        type="text"
                        className="nexus-input"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        style={{ width: 110 }}
                      />
                    </div>
                  </div>

                  <div className="nexus-form-group" style={{ margin: 0 }}>
                    <label className="nexus-form-label">Theme Mode & Position</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        className="nexus-input"
                        value={darkMode ? 'dark' : 'light'}
                        onChange={(e) => setDarkMode(e.target.value === 'dark')}
                      >
                        <option value="dark">Dark Theme</option>
                        <option value="light">Light Theme</option>
                      </select>
                      <select
                        className="nexus-input"
                        value={position}
                        onChange={(e) => setPosition(e.target.value as any)}
                      >
                        <option value="bottom-right">Bottom Right</option>
                        <option value="bottom-left">Bottom Left</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Preset color pills */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: primaryColor === c.hex ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${primaryColor === c.hex ? c.hex : 'rgba(255,255,255,0.1)'}`,
                        color: '#cbd5e1',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                      onClick={() => setPrimaryColor(c.hex)}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: c.hex }} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Greeting Message */}
              <div className="nexus-form-group">
                <label className="nexus-form-label">Welcome / Greeting Message</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. Greetings, Operator. Sentinel Cyber Copilot is online."
                  value={greetingMessage}
                  onChange={(e) => setGreetingMessage(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Model Policy & Temperature */}
              <div className="nexus-grid-two-col" style={{ gap: 12 }}>
                <div className="nexus-form-group">
                  <label className="nexus-form-label">Model Routing Policy</label>
                  <select
                    className="nexus-input"
                    value={modelPolicy}
                    onChange={(e) => setModelPolicy(e.target.value as ModelPolicy)}
                    disabled={isSubmitting}
                  >
                    <option value="local-only">Local-Only (Ollama / Qwen)</option>
                    <option value="cloud-preferred">Cloud-Preferred with Local Fallback</option>
                    <option value="hybrid">Hybrid (Task Complexity Routed)</option>
                    <option value="cloud-only">Cloud-Only (OpenAI / Anthropic)</option>
                  </select>
                </div>

                <div className="nexus-form-group">
                  <label className="nexus-form-label">Temperature: {temperature}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    className="nexus-input"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* System Prompt */}
              <div className="nexus-form-group">
                <label className="nexus-form-label">System Prompt (Instructions) *</label>
                <textarea
                  className="nexus-input"
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              {/* Suggested Prompts */}
              <div className="nexus-form-group">
                <label className="nexus-form-label">Suggested Prompts (one per line)</label>
                <textarea
                  className="nexus-input"
                  rows={2}
                  value={promptsText}
                  onChange={(e) => setPromptsText(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Public Embed Checkbox */}
              <div className="nexus-checkbox-group" style={{ marginBottom: 16 }}>
                <input
                  type="checkbox"
                  id="asst-public-embed"
                  checked={publicEmbedAllowed}
                  onChange={(e) => setPublicEmbedAllowed(e.target.checked)}
                  disabled={isSubmitting}
                />
                <label htmlFor="asst-public-embed" style={{ fontSize: 13, color: '#cbd5e1' }}>
                  Allow Public Embed (Enables widget embedding on third-party SaaS pages without user session)
                </label>
              </div>

              {/* Actions */}
              <div className="nexus-modal-actions">
                <button
                  type="button"
                  className="nexus-btn-ghost"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setEditModalAssistant(null);
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="nexus-btn-primary" disabled={isSubmitting}>
                  {isSubmitting
                    ? 'Saving...'
                    : editModalAssistant
                    ? 'Save Assistant Changes'
                    : 'Create Assistant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Associate Knowledge Spaces */}
      {spacesModalAssistant && (
        <div className="nexus-modal-overlay" onClick={() => setSpacesModalAssistant(null)}>
          <div className="nexus-modal-card" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="nexus-modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Associate Knowledge Spaces</h3>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Assistant: <strong>{spacesModalAssistant.name}</strong> ({activeWorkspace.name})
                </span>
              </div>
              <button
                type="button"
                className="nexus-close-btn"
                onClick={() => setSpacesModalAssistant(null)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 16px 0' }}>
              Select which knowledge bases this assistant is authorized to search. Grounded answers and citations
              are generated strictly from the linked spaces in this project.
            </p>

            {knowledgeSpaces.length === 0 ? (
              <div className="nexus-empty-state" style={{ padding: 20 }}>
                <p>No knowledge spaces available in project {activeWorkspace.name}. Create one in Knowledge Bases first.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
                {knowledgeSpaces.map((space) => {
                  const currentLinked = assistantSpaces[spacesModalAssistant.id] || [];
                  const isLinked = currentLinked.some((s) => s.id === space.id);

                  return (
                    <div
                      key={space.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: isLinked ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                        border: `1px solid ${isLinked ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)'}`,
                        borderRadius: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#f8fafc' }}>
                          {space.name}
                        </div>
                        <code style={{ fontSize: 11, color: '#94a3b8' }}>/{space.slug}</code>
                      </div>

                      <button
                        type="button"
                        className={isLinked ? 'nexus-btn-secondary' : 'nexus-btn-primary'}
                        style={{ padding: '5px 12px', fontSize: 12 }}
                        disabled={spacesLoading}
                        onClick={() => handleToggleSpaceLink(spacesModalAssistant.id, space.id, isLinked)}
                      >
                        {isLinked ? '✓ Linked (Click to Unlink)' : '➕ Link to Assistant'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="nexus-modal-actions" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="nexus-btn-primary"
                onClick={() => setSpacesModalAssistant(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Live Widget Preview */}
      {previewAssistant && (
        <div className="nexus-modal-overlay" onClick={() => setPreviewAssistant(null)}>
          <div
            className="nexus-modal-card"
            style={{ maxWidth: 880, width: '94%', height: '82vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nexus-modal-header" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Live Widget Preview: {previewAssistant.name}</h3>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Real-time interactive session with RAG knowledge scope & theme customization
                </span>
              </div>
              <button
                type="button"
                className="nexus-close-btn"
                onClick={() => setPreviewAssistant(null)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                position: 'relative',
                background: previewAssistant.theme?.darkMode !== false ? '#090d16' : '#f1f5f9',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                overflow: 'hidden',
                padding: 20,
              }}
            >
              <div style={{ maxWidth: 450, color: previewAssistant.theme?.darkMode !== false ? '#94a3b8' : '#475569' }}>
                <h4 style={{ margin: '0 0 6px 0', color: previewAssistant.theme?.darkMode !== false ? '#f8fafc' : '#0f172a' }}>
                  Simulated SaaS Host Application
                </h4>
                <p style={{ fontSize: 13, margin: '0 0 10px 0' }}>
                  The Nexus chat widget is mounted in the corner according to the assistant's configured placement (
                  <strong>{previewAssistant.theme?.position || 'bottom-right'}</strong>) and theme color (
                  <span style={{ color: previewAssistant.theme?.primaryColor || '#06b6d4', fontWeight: 600 }}>
                    {previewAssistant.theme?.primaryColor || '#06b6d4'}
                  </span>
                  ).
                </p>
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>• Greeting: "{previewAssistant.greeting_message || 'Greetings!'}"</div>
                  <div>• Policy: {previewAssistant.model_policy}</div>
                  <div>• Linked Spaces: {(assistantSpaces[previewAssistant.id] || []).length} spaces</div>
                </div>
              </div>

              {/* Real Actual Widget Component */}
              <NexusChatWidget
                assistantId={previewAssistant.id}
                apiBaseUrl={api.getBaseUrl()}
                title={previewAssistant.name}
                initialOpen={true}
                position={(previewAssistant.theme?.position as any) || 'bottom-right'}
                themeOverrides={{
                  primaryColor: previewAssistant.theme?.primaryColor || '#06b6d4',
                  darkMode: previewAssistant.theme?.darkMode !== false,
                }}
              />
            </div>

            <div className="nexus-modal-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="nexus-btn-ghost"
                onClick={() => {
                  onSelectForWidgetConfig(previewAssistant);
                  setPreviewAssistant(null);
                }}
              >
                Go to Widget Embed Studio →
              </button>
              <button
                type="button"
                className="nexus-btn-primary"
                onClick={() => setPreviewAssistant(null)}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
