import React from 'react';
import { NexusChatWidget } from '@nomaanos/nexus-widget';
import '@nomaanos/nexus-widget/style.css';
import { AssistantSummary, WidgetCustomizationConfig, WorkspaceSummary } from '../types';

interface PlaygroundViewProps {
  config: WidgetCustomizationConfig;
  assistants: AssistantSummary[];
  activeWorkspace: WorkspaceSummary | null;
  onSelectAssistant: (assistant: AssistantSummary) => void;
}

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  config,
  assistants,
  activeWorkspace,
  onSelectAssistant,
}) => {
  return (
    <div className="nexus-view-container">
      <div className="nexus-page-header">
        <div>
          <h1 className="nexus-page-title">Testing Playground</h1>
          <p className="nexus-page-subtitle">
            Live interactive environment connected to your Nexus AI backend on port 4001. Test query processing,
            hybrid retrieval, evidence assembly, citations, and grounded answer synthesis.
          </p>
        </div>
      </div>

      <div className="nexus-grid-two-col">
        {/* Left Side: Diagnostics and Assistant Switcher */}
        <div className="nexus-card">
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">🧪</span>
              <h3 className="nexus-card-title">Copilot Session Parameters</h3>
            </div>
          </div>

          <div className="nexus-form-group">
            <label className="nexus-form-label">Active Assistant</label>
            <select
              className="nexus-input"
              value={config.assistantId}
              onChange={(e) => {
                const found = assistants.find((a) => a.id === e.target.value);
                if (found) onSelectAssistant(found);
              }}
            >
              {assistants.map((asst) => (
                <option key={asst.id} value={asst.id}>
                  {asst.name} ({asst.model_policy})
                </option>
              ))}
              {assistants.length === 0 && (
                <option value="">No assistants configured</option>
              )}
            </select>
          </div>

          <div className="nexus-detail-list">
            <div className="nexus-detail-item">
              <span className="nexus-detail-label">Assistant ID:</span>
              <code className="nexus-detail-code">{config.assistantId}</code>
            </div>
            <div className="nexus-detail-item">
              <span className="nexus-detail-label">Backend URL:</span>
              <code>{config.apiBaseUrl}</code>
            </div>
            <div className="nexus-detail-item">
              <span className="nexus-detail-label">Position:</span>
              <span>{config.position}</span>
            </div>
            <div className="nexus-detail-item">
              <span className="nexus-detail-label">Active Theme:</span>
              <span>{config.darkMode ? 'Dark' : 'Light'}</span>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#38bdf8', fontSize: 13 }}>💡 Suggested Test Inquiries</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="nexus-tag" style={{ padding: '8px 12px', fontSize: 12 }}>
                "How do air-gapped data diode updates work?"
              </div>
              <div className="nexus-tag" style={{ padding: '8px 12px', fontSize: 12 }}>
                "Analyze SSH brute-force alert telemetry"
              </div>
              <div className="nexus-tag" style={{ padding: '8px 12px', fontSize: 12 }}>
                "What are the authorized tool calling protocols?"
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, padding: 12, background: 'rgba(16, 185, 129, 0.05)', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.2)' }}>
            <span style={{ color: '#34d399', fontWeight: 600, fontSize: 12 }}>RAG Grounded Citations</span>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#94a3b8' }}>
              Whenever the assistant references indexed documents, verified citations with chunk IDs, section paths,
              and relevance scores are attached directly into the conversation payload.
            </p>
          </div>
        </div>

        {/* Right Side: Embedded Live Widget Mounted */}
        <div className="nexus-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 460 }}>
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">💬</span>
              <h3 className="nexus-card-title">Live Chat Widget</h3>
            </div>
            <span className="nexus-badge status-healthy">Live Interactive</span>
          </div>

          <p style={{ fontSize: 13, color: '#94a3b8' }}>
            The floating widget launcher is active on the <strong>{config.position}</strong> of your screen.
            Click the floating launcher button or interact below to submit test inquiries.
          </p>

          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 12,
              border: '1px dashed rgba(255,255,255,0.1)',
              padding: 24,
              textAlign: 'center',
            }}
          >
            {config.assistantId ? (
              <div>
                <span style={{ fontSize: 42 }}>👇</span>
                <h4 style={{ margin: '12px 0 6px 0', color: '#f8fafc' }}>Widget is Mounted</h4>
                <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 320 }}>
                  Look at the <strong>{config.position === 'bottom-right' ? 'bottom-right' : 'bottom-left'}</strong> corner
                  to open the copilot dialog window and test live conversation messages.
                </p>
              </div>
            ) : (
              <div>
                <span style={{ fontSize: 42 }}>🤖</span>
                <h4 style={{ margin: '12px 0 6px 0', color: '#f8fafc' }}>No Assistant Selected</h4>
                <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 320 }}>
                  Please create or select an assistant persona in this project to launch and test in the playground.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

