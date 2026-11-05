import React, { useState } from 'react';
import { NexusChatWidget } from '@nomaanos/nexus-widget';
import '@nomaanos/nexus-widget/style.css';
import { AssistantSummary, KnowledgeSpaceSummary, WidgetCustomizationConfig, WorkspaceSummary } from '../types';
import { api } from '../services/api';

interface WidgetConfigViewProps {
  assistants: AssistantSummary[];
  knowledgeSpaces: KnowledgeSpaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  config: WidgetCustomizationConfig;
  onChangeConfig: (newConfig: WidgetCustomizationConfig) => void;
  onOpenPlayground: () => void;
  onSaveAssistantConfig?: (assistantId: string, data: any) => Promise<void>;
}

export const WidgetConfigView: React.FC<WidgetConfigViewProps> = ({
  assistants,
  knowledgeSpaces,
  activeWorkspace,
  config,
  onChangeConfig,
  onOpenPlayground,
  onSaveAssistantConfig,
}) => {
  const [activeCodeTab, setActiveCodeTab] = useState<'script' | 'programmatic' | 'react'>('react');
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const PRESET_COLORS = [
    { label: 'Sentinel Cyan', hex: '#06b6d4' },
    { label: 'Nexus Blue', hex: '#3b82f6' },
    { label: 'Cloud Emerald', hex: '#10b981' },
    { label: 'Violet AI', hex: '#8b5cf6' },
    { label: 'Amber Alert', hex: '#f59e0b' },
    { label: 'Rose Incident', hex: '#ef4444' },
  ];

  const currentAssistant = assistants.find((a) => a.id === config.assistantId) || assistants[0] || null;

  // React component installation snippet
  const reactEmbedCode = `// 1. Install widget dependency via npm or pnpm
// npm install @nomaanos/nexus-widget

import React from 'react';
import { NexusChatWidget } from '@nomaanos/nexus-widget';
import '@nomaanos/nexus-widget/style.css';

export function SaaSApplicationChat() {
  return (
    <NexusChatWidget
      assistantId="${config.assistantId}"
      apiBaseUrl="${config.apiBaseUrl}"
      title="${config.title}"
      position="${config.position}"
      themeOverrides={{
        primaryColor: '${config.primaryColor}',
        darkMode: ${config.darkMode},
      }}
      initialOpen={false}
      onMessageSent={(msg) => console.log('User sent:', msg)}
      onResponseReceived={(res) => console.log('Assistant response:', res)}
    />
  );
}`;

  // Declarative Script tag snippet
  const scriptEmbedCode = `<!-- NomaanOS Nexus AI Universal Widget Embed -->
<!-- Place inside <head> or right before </body> of your SaaS web application -->
<link rel="stylesheet" href="${config.apiBaseUrl}/widget/style.css" />
<script
  src="${config.apiBaseUrl}/widget/nexus-widget.umd.js"
  data-assistant-id="${config.assistantId}"
  data-api-base-url="${config.apiBaseUrl}"
  data-title="${config.title}"
  data-primary-color="${config.primaryColor}"
  data-dark-mode="${config.darkMode}"
  data-position="${config.position}"
  async>
</script>`;

  // Programmatic JavaScript initialization snippet
  const programmaticEmbedCode = `<!-- Standalone Script with Programmatic Initialization -->
<link rel="stylesheet" href="${config.apiBaseUrl}/widget/style.css" />
<script src="${config.apiBaseUrl}/widget/nexus-widget.umd.js"></script>

<script>
  window.addEventListener('DOMContentLoaded', function () {
    window.NexusWidget.init({
      assistantId: '${config.assistantId}',
      apiBaseUrl: '${config.apiBaseUrl}',
      title: '${config.title}',
      position: '${config.position}',
      themeOverrides: {
        primaryColor: '${config.primaryColor}',
        darkMode: ${config.darkMode}
      }
    });
  });
</script>`;

  const getActiveCode = () => {
    switch (activeCodeTab) {
      case 'react':
        return reactEmbedCode;
      case 'script':
        return scriptEmbedCode;
      case 'programmatic':
        return programmaticEmbedCode;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getActiveCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Persist branding & styling changes to the assistant record
  const handleSaveToAssistant = async () => {
    if (!currentAssistant || !activeWorkspace) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const updatePayload = {
        name: config.title,
        greetingMessage: config.greetingMessage,
        theme: {
          primaryColor: config.primaryColor,
          darkMode: config.darkMode,
          position: config.position,
        },
      };

      if (onSaveAssistantConfig) {
        await onSaveAssistantConfig(currentAssistant.id, updatePayload);
      } else {
        await api.updateAssistant(activeWorkspace.id, currentAssistant.id, updatePayload);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to persist assistant configuration.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="nexus-view-container">
      {/* Header */}
      <div className="nexus-page-header">
        <div>
          <h1 className="nexus-page-title">Widget Customizer & Embed Studio</h1>
          <p className="nexus-page-subtitle">
            Configure visual styling, brand colors, placement, and generate embed codes for web applications.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="nexus-btn-ghost" onClick={handleSaveToAssistant} disabled={isSaving}>
            {isSaving ? 'Saving...' : '💾 Save to Assistant Persona'}
          </button>
          <button type="button" className="nexus-btn-primary" onClick={onOpenPlayground}>
            <span>🧪</span> Open Full Playground
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="nexus-form-success" style={{ marginBottom: 16 }}>
          ✓ Assistant styling and widget options persisted to backend successfully!
        </div>
      )}
      {saveError && (
        <div className="nexus-form-error" style={{ marginBottom: 16 }}>
          ⚠️ {saveError}
        </div>
      )}

      <div className="nexus-grid-two-col">
        {/* Left Column: Visual Customizer Controls */}
        <div className="nexus-card">
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">🎨</span>
              <h3 className="nexus-card-title">Widget Configuration</h3>
            </div>
            {currentAssistant && (
              <span className="nexus-badge status-healthy" style={{ fontSize: 12 }}>
                Assistant: {currentAssistant.name}
              </span>
            )}
          </div>

          {/* Assistant Selector */}
          <div className="nexus-form-group">
            <label className="nexus-form-label">Target Copilot Assistant *</label>
            <select
              className="nexus-input"
              value={config.assistantId}
              onChange={(e) => {
                const selectedAsst = assistants.find((a) => a.id === e.target.value);
                if (selectedAsst) {
                  onChangeConfig({
                    ...config,
                    assistantId: selectedAsst.id,
                    title: selectedAsst.name,
                    primaryColor: selectedAsst.theme?.primaryColor || config.primaryColor,
                    darkMode: selectedAsst.theme?.darkMode !== false,
                    position: (selectedAsst.theme?.position as any) || config.position,
                    greetingMessage: selectedAsst.greeting_message || config.greetingMessage,
                  });
                }
              }}
            >
              {assistants.map((asst) => (
                <option key={asst.id} value={asst.id}>
                  {asst.name} ({asst.assistant_key})
                </option>
              ))}
              {assistants.length === 0 && (
                <option value="">No assistants configured</option>
              )}
            </select>
          </div>

          {/* Title */}
          <div className="nexus-form-group">
            <label className="nexus-form-label">Widget Header Title</label>
            <input
              type="text"
              className="nexus-input"
              value={config.title}
              onChange={(e) => onChangeConfig({ ...config, title: e.target.value })}
            />
          </div>

          {/* Brand Color Picker */}
          <div className="nexus-form-group">
            <label className="nexus-form-label">Primary Brand Accent</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                type="color"
                value={config.primaryColor}
                onChange={(e) => onChangeConfig({ ...config, primaryColor: e.target.value })}
                style={{
                  width: 44,
                  height: 38,
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
                style={{ width: 120 }}
                value={config.primaryColor}
                onChange={(e) => onChangeConfig({ ...config, primaryColor: e.target.value })}
              />
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: config.primaryColor === c.hex ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${config.primaryColor === c.hex ? c.hex : 'rgba(255,255,255,0.1)'}`,
                    color: '#e2e8f0',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                  onClick={() => onChangeConfig({ ...config, primaryColor: c.hex })}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: c.hex }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Theme Mode & Placement */}
          <div className="nexus-grid-two-col" style={{ gap: 12 }}>
            <div className="nexus-form-group">
              <label className="nexus-form-label">Color Theme</label>
              <select
                className="nexus-input"
                value={config.darkMode ? 'dark' : 'light'}
                onChange={(e) => onChangeConfig({ ...config, darkMode: e.target.value === 'dark' })}
              >
                <option value="dark">Dark Theme (Cyber)</option>
                <option value="light">Light Theme (Clean Docs)</option>
              </select>
            </div>

            <div className="nexus-form-group">
              <label className="nexus-form-label">Screen Position</label>
              <select
                className="nexus-input"
                value={config.position}
                onChange={(e) =>
                  onChangeConfig({ ...config, position: e.target.value as 'bottom-right' | 'bottom-left' })
                }
              >
                <option value="bottom-right">Bottom Right Corner</option>
                <option value="bottom-left">Bottom Left Corner</option>
              </select>
            </div>
          </div>

          {/* Greeting message */}
          <div className="nexus-form-group">
            <label className="nexus-form-label">Greeting Welcome Message</label>
            <input
              type="text"
              className="nexus-input"
              value={config.greetingMessage}
              onChange={(e) => onChangeConfig({ ...config, greetingMessage: e.target.value })}
            />
          </div>

          {/* Backend Base URL */}
          <div className="nexus-form-group">
            <label className="nexus-form-label">Nexus AI API Endpoint Base</label>
            <input
              type="text"
              className="nexus-input"
              value={config.apiBaseUrl}
              onChange={(e) => onChangeConfig({ ...config, apiBaseUrl: e.target.value })}
            />
          </div>
        </div>

        {/* Right Column: Code Snippet Generator */}
        <div className="nexus-card">
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">💻</span>
              <h3 className="nexus-card-title">Installation & Embed Codes</h3>
            </div>
            <button
              type="button"
              className="nexus-btn-primary"
              style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied!' : 'Copy Code'}
            </button>
          </div>

          {/* Code Tabs */}
          <div className="nexus-tabs-sub">
            <button
              type="button"
              className={`nexus-tab-sub-btn ${activeCodeTab === 'react' ? 'active' : ''}`}
              onClick={() => setActiveCodeTab('react')}
            >
              ⚛️ React (NPM)
            </button>
            <button
              type="button"
              className={`nexus-tab-sub-btn ${activeCodeTab === 'script' ? 'active' : ''}`}
              onClick={() => setActiveCodeTab('script')}
            >
              📄 HTML Script Tag
            </button>
            <button
              type="button"
              className={`nexus-tab-sub-btn ${activeCodeTab === 'programmatic' ? 'active' : ''}`}
              onClick={() => setActiveCodeTab('programmatic')}
            >
              ⚙️ JavaScript (init)
            </button>
          </div>

          <pre className="nexus-code-block" style={{ maxHeight: 280, overflowY: 'auto' }}>
            <code>{getActiveCode()}</code>
          </pre>

          {/* Scope & Authorization Security Invariant Callout */}
          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: 'rgba(56, 189, 248, 0.05)',
              borderRadius: 8,
              border: '1px solid rgba(56, 189, 248, 0.2)',
            }}
          >
            <h4 style={{ margin: '0 0 6px 0', color: '#38bdf8', fontSize: 13 }}>
              🛡️ Zero Trust Server-Side Scope Invariant
            </h4>
            <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
              The widget client only sends the configured <code>assistantId</code>. The backend verifies tenant
              membership and enforces knowledge space permissions server-side. Browser-side configuration cannot
              grant access to private or unlinked knowledge spaces.
            </p>
          </div>
        </div>
      </div>

      {/* Live Preview Container with Actual Embedded Widget */}
      <div className="nexus-card" style={{ marginTop: 24 }}>
        <div className="nexus-card-header">
          <div className="nexus-card-title-group">
            <span className="nexus-card-icon">👁️</span>
            <div>
              <h3 className="nexus-card-title">Live Interactive Widget Preview</h3>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Rendered with the real <code>NexusChatWidget</code> component using current options.
              </p>
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            height: 480,
            background: config.darkMode ? '#080c14' : '#f8fafc',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            overflow: 'hidden',
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 440, color: config.darkMode ? '#94a3b8' : '#475569' }}>
            <h4 style={{ margin: '0 0 8px 0', color: config.darkMode ? '#f8fafc' : '#0f172a' }}>
              Simulated SaaS Customer Dashboard
            </h4>
            <p style={{ fontSize: 13, margin: '0 0 10px 0' }}>
              The copilot widget is rendered at position: <strong>{config.position}</strong> with primary accent:
              <span style={{ color: config.primaryColor, fontWeight: 600, marginLeft: 6 }}>
                {config.primaryColor}
              </span>
              . Click the chat button to launch and send inquiries!
            </p>
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>• Assistant: {config.title}</div>
              <div>• Initial Greeting: "{config.greetingMessage}"</div>
              <div>• Mode: {config.darkMode ? 'Dark' : 'Light'}</div>
            </div>
          </div>

          {/* Actual Widget Component */}
          {config.assistantId ? (
            <NexusChatWidget
              key={`${config.assistantId}-${config.primaryColor}-${config.darkMode}-${config.position}`}
              assistantId={config.assistantId}
              apiBaseUrl={config.apiBaseUrl}
              title={config.title}
              position={config.position}
              themeOverrides={{
                primaryColor: config.primaryColor,
                darkMode: config.darkMode,
              }}
              initialOpen={true}
            />
          ) : (
            <div
              style={{
                marginTop: 40,
                padding: 30,
                textAlign: 'center',
                border: '1px dashed rgba(255, 255, 255, 0.15)',
                borderRadius: 8,
                color: '#94a3b8',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
              <h4 style={{ color: '#f8fafc', marginBottom: 6 }}>No Assistant Selected</h4>
              <p style={{ margin: 0, fontSize: 13 }}>
                Create or select an assistant persona in this project to preview the live interactive widget.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
