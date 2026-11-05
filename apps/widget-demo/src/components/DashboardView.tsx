import React from 'react';
import {
  WorkspaceSummary,
  AssistantSummary,
  KnowledgeSpaceSummary,
  PlatformHealth,
  NavigationTab,
} from '../types';

interface DashboardViewProps {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  assistants: AssistantSummary[];
  knowledgeSpaces: KnowledgeSpaceSummary[];
  health: PlatformHealth;
  onNavigate: (tab: NavigationTab) => void;
  onOpenCreateProject: () => void;
  onOpenCreateAssistant: () => void;
  apiConnected: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  workspaces,
  activeWorkspace,
  assistants,
  knowledgeSpaces,
  health,
  onNavigate,
  onOpenCreateProject,
  onOpenCreateAssistant,
  apiConnected,
}) => {
  return (
    <div className="nexus-view-container">
      {/* Offline API Notice */}
      {!apiConnected && (
        <div className="nexus-alert-banner warning">
          <span className="nexus-alert-icon">⚠️</span>
          <div className="nexus-alert-content">
            <strong>Backend API Offline</strong>
            <p>
              The Nexus AI backend is currently disconnected or unreachable at <code>http://localhost:4001</code>.
              Start the backend with <code>npm start</code> or <code>npm run dev</code> to sync real data.
            </p>
          </div>
        </div>
      )}

      {/* Hero Banner */}
      <div className="nexus-hero-banner">
        <div className="nexus-hero-text">
          <h1 className="nexus-hero-title">Universal AI Documentation Platform</h1>
          <p className="nexus-hero-subtitle">
            Deploy grounded, context-aware AI copilots across all ecosystem applications with hybrid retrieval,
            role-based permissions, and embeddable chat widgets.
          </p>
        </div>
        <div className="nexus-hero-actions">
          <button type="button" className="nexus-btn-primary" onClick={onOpenCreateProject}>
            <span>➕</span> New Project
          </button>
          <button type="button" className="nexus-btn-secondary" onClick={() => onNavigate('playground')}>
            <span>🧪</span> Open Playground
          </button>
        </div>
      </div>

      {/* Top Stat Counters */}
      <div className="nexus-stats-grid">
        <div className="nexus-stat-card" onClick={() => onNavigate('projects')} style={{ cursor: 'pointer' }}>
          <div className="nexus-stat-header">
            <span className="nexus-stat-title">Active Projects</span>
            <span className="nexus-stat-icon">📁</span>
          </div>
          <div className="nexus-stat-value">{workspaces.length}</div>
          <div className="nexus-stat-footer">Multi-tenant workspaces</div>
        </div>

        <div className="nexus-stat-card" onClick={() => onNavigate('assistants')} style={{ cursor: 'pointer' }}>
          <div className="nexus-stat-header">
            <span className="nexus-stat-title">Configured Assistants</span>
            <span className="nexus-stat-icon">🤖</span>
          </div>
          <div className="nexus-stat-value">{assistants.length}</div>
          <div className="nexus-stat-footer">Grounded chat copilots</div>
        </div>

        <div className="nexus-stat-card" onClick={() => onNavigate('knowledge-bases')} style={{ cursor: 'pointer' }}>
          <div className="nexus-stat-header">
            <span className="nexus-stat-title">Knowledge Bases</span>
            <span className="nexus-stat-icon">📚</span>
          </div>
          <div className="nexus-stat-value">{knowledgeSpaces.length}</div>
          <div className="nexus-stat-footer">Hybrid indexed document spaces</div>
        </div>

        <div className="nexus-stat-card">
          <div className="nexus-stat-header">
            <span className="nexus-stat-title">Inference Engine</span>
            <span className="nexus-stat-icon">⚙️</span>
          </div>
          <div className="nexus-stat-value" style={{ fontSize: 20, color: '#38bdf8' }}>
            {health.activeModel || (health.status === 'healthy' ? 'Ollama' : 'Deterministic')}
          </div>
          <div className="nexus-stat-footer">
            Policy: {health.localOnly ? 'Local-Only (Air-Gapped)' : 'Hybrid Routing'}
          </div>
        </div>
      </div>

      {/* Active Project Highlight & Architecture Card */}
      <div className="nexus-grid-two-col">
        {/* Active Project Card */}
        <div className="nexus-card">
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">📁</span>
              <h3 className="nexus-card-title">Active Project</h3>
            </div>
            {activeWorkspace && (
              <span className="nexus-badge role">{activeWorkspace.role || 'owner'}</span>
            )}
          </div>

          {activeWorkspace ? (
            <div className="nexus-project-summary-box">
              <div className="nexus-project-headline">
                <span className="nexus-project-name">{activeWorkspace.name}</span>
                <code className="nexus-project-slug">/{activeWorkspace.slug}</code>
              </div>

              <div className="nexus-detail-list">
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Project ID:</span>
                  <code className="nexus-detail-code">{activeWorkspace.id}</code>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Status:</span>
                  <span className="nexus-badge status">{activeWorkspace.status || 'active'}</span>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Linked Assistants:</span>
                  <span>{assistants.length} Copilots</span>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Knowledge Bases:</span>
                  <span>{knowledgeSpaces.length} Spaces</span>
                </div>
              </div>

              <div className="nexus-card-footer-actions">
                <button type="button" className="nexus-btn-ghost" onClick={() => onNavigate('projects')}>
                  Manage Projects
                </button>
                <button type="button" className="nexus-btn-primary" onClick={onOpenCreateAssistant}>
                  <span>➕</span> Add Assistant
                </button>
              </div>
            </div>
          ) : (
            <div className="nexus-empty-state">
              <p>No active project selected.</p>
              <button type="button" className="nexus-btn-primary" onClick={onOpenCreateProject}>
                Create Your First Project
              </button>
            </div>
          )}
        </div>

        {/* Platform Architecture & RAG Pipeline Status */}
        <div className="nexus-card">
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">🛡️</span>
              <h3 className="nexus-card-title">Protected RAG Architecture</h3>
            </div>
            <span className="nexus-badge status-healthy">Operational</span>
          </div>

          <p className="nexus-card-description">
            Nexus AI runs a verified 19-day production RAG foundation with strict zero-leakage security invariants:
          </p>

          <div className="nexus-feature-checks">
            <div className="nexus-check-item">
              <span className="nexus-check-icon">✓</span>
              <div>
                <strong>PostgreSQL Hybrid Retrieval:</strong> Reciprocal Rank Fusion of pgvector semantic vectors and full-text search.
              </div>
            </div>
            <div className="nexus-check-item">
              <span className="nexus-check-icon">✓</span>
              <div>
                <strong>Evidence Assembly & Reranking:</strong> Cross-encoder relevance scoring with context budget budgeting.
              </div>
            </div>
            <div className="nexus-check-item">
              <span className="nexus-check-icon">✓</span>
              <div>
                <strong>Zero Model Hallucination:</strong> Backend citation validation and contradiction detection.
              </div>
            </div>
            <div className="nexus-check-item">
              <span className="nexus-check-icon">✓</span>
              <div>
                <strong>Air-Gapped Private Deployment:</strong> Local model inference via Ollama with zero external cloud egress.
              </div>
            </div>
          </div>

          <div className="nexus-card-footer-actions" style={{ marginTop: 16 }}>
            <button type="button" className="nexus-btn-secondary" onClick={() => onNavigate('widget-config')}>
              Configure Chat Widget
            </button>
            <button type="button" className="nexus-btn-ghost" onClick={() => onNavigate('showcases')}>
              View Ecosystem Showcases
            </button>
          </div>
        </div>
      </div>

      {/* Quick Launchpad Grid */}
      <div className="nexus-section-header">
        <h2>Quick Workflow Actions</h2>
      </div>

      <div className="nexus-launchpad-grid">
        <div className="nexus-launchpad-card" onClick={() => onNavigate('widget-config')}>
          <span className="nexus-launchpad-icon">🎨</span>
          <h4>Widget Customizer</h4>
          <p>Customize branding colors, dark mode, positioning, and generate embed scripts.</p>
        </div>

        <div className="nexus-launchpad-card" onClick={() => onNavigate('knowledge-bases')}>
          <span className="nexus-launchpad-icon">📚</span>
          <h4>Knowledge Management</h4>
          <p>Manage documents, full-text indexes, and verify vector embedding status.</p>
        </div>

        <div className="nexus-launchpad-card" onClick={() => onNavigate('assistants')}>
          <span className="nexus-launchpad-icon">🤖</span>
          <h4>Copilot Personas</h4>
          <p>Tune system prompts, model policy routing, and suggested user inquiries.</p>
        </div>

        <div className="nexus-launchpad-card" onClick={() => onNavigate('showcases')}>
          <span className="nexus-launchpad-icon">🌐</span>
          <h4>Showcase Demonstrations</h4>
          <p>Switch between Sentinel SOC, Developer Documentation, and Cloud Operations.</p>
        </div>
      </div>
    </div>
  );
};

