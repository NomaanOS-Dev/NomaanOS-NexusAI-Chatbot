import React, { useState } from 'react';
import { WorkspaceSummary, AssistantSummary, KnowledgeSpaceSummary } from '../types';

interface ProjectsViewProps {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string, slug?: string) => Promise<void>;
  assistants: AssistantSummary[];
  knowledgeSpaces: KnowledgeSpaceSummary[];
  loading: boolean;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
  assistants,
  knowledgeSpaces,
  loading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectSlug, setProjectSlug] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const filtered = workspaces.filter(
    (w) =>
      w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setErrorMessage('Project name is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onCreateWorkspace(projectName.trim(), projectSlug.trim() || undefined);
      setSuccessMessage(`Project "${projectName}" created successfully!`);
      setProjectName('');
      setProjectSlug('');
      setTimeout(() => {
        setModalOpen(false);
        setSuccessMessage(null);
      }, 1200);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="nexus-view-container">
      {/* Header and Action */}
      <div className="nexus-page-header">
        <div>
          <h1 className="nexus-page-title">Enterprise Projects</h1>
          <p className="nexus-page-subtitle">
            Manage multi-tenant workspaces, team access roles, and project-scoped AI copilots.
          </p>
        </div>
        <button type="button" className="nexus-btn-primary" onClick={() => setModalOpen(true)}>
          <span>➕</span> New Project
        </button>
      </div>

      {/* Filter Bar */}
      <div className="nexus-filter-bar">
        <input
          type="text"
          className="nexus-input"
          placeholder="Search projects by name or slug..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          Showing {filtered.length} of {workspaces.length} projects
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="nexus-loading-state">
          <div className="nexus-spinner" />
          <p>Loading projects from backend...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="nexus-empty-state">
          <span style={{ fontSize: 36 }}>📁</span>
          <h3>No Projects Found</h3>
          <p>
            {searchTerm
              ? `No projects match "${searchTerm}".`
              : 'You have not created any projects yet. Create a workspace to begin organizing documentation.'}
          </p>
          <button type="button" className="nexus-btn-primary" onClick={() => setModalOpen(true)}>
            Create Project
          </button>
        </div>
      ) : (
        <div className="nexus-projects-grid">
          {filtered.map((ws) => {
            const isSelected = activeWorkspace?.id === ws.id;
            return (
              <div
                key={ws.id}
                className={`nexus-project-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectWorkspace(ws.id)}
              >
                <div className="nexus-project-card-header">
                  <div>
                    <h3 className="nexus-project-card-title">{ws.name}</h3>
                    <code className="nexus-project-card-slug">/{ws.slug}</code>
                  </div>
                  <span className="nexus-badge role">{ws.role || 'member'}</span>
                </div>

                <div className="nexus-project-card-body">
                  <div className="nexus-detail-item">
                    <span className="nexus-detail-label">Status:</span>
                    <span className="nexus-badge status">{ws.status}</span>
                  </div>
                  <div className="nexus-detail-item">
                    <span className="nexus-detail-label">Created:</span>
                    <span>{new Date(ws.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="nexus-detail-item">
                    <span className="nexus-detail-label">Project ID:</span>
                    <code className="nexus-detail-code">{ws.id.slice(0, 13)}...</code>
                  </div>
                </div>

                <div className="nexus-project-card-footer">
                  {isSelected ? (
                    <span className="nexus-active-indicator">✓ Active Project</span>
                  ) : (
                    <button type="button" className="nexus-btn-ghost">
                      Select Project
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Project Details Inspection Drawer */}
      {activeWorkspace && (
        <div className="nexus-card" style={{ marginTop: 24 }}>
          <div className="nexus-card-header">
            <div className="nexus-card-title-group">
              <span className="nexus-card-icon">🔍</span>
              <h3 className="nexus-card-title">Project Details: {activeWorkspace.name}</h3>
            </div>
            <span className="nexus-badge status-healthy">Selected Enclave</span>
          </div>

          <div className="nexus-grid-two-col">
            <div>
              <h4 style={{ margin: '0 0 12px 0', color: '#38bdf8' }}>Project Metadata</h4>
              <div className="nexus-detail-list">
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Full Workspace UUID:</span>
                  <code className="nexus-detail-code">{activeWorkspace.id}</code>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Slug:</span>
                  <code>{activeWorkspace.slug}</code>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Caller Role:</span>
                  <span className="nexus-badge role">{activeWorkspace.role || 'viewer'}</span>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Joined At:</span>
                  <span>{activeWorkspace.joined_at ? new Date(activeWorkspace.joined_at).toLocaleString() : 'N/A'}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px 0', color: '#34d399' }}>Associated Resources</h4>
              <div className="nexus-detail-list">
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Configured Assistants:</span>
                  <span>{assistants.length} Copilots</span>
                </div>
                <div className="nexus-detail-item">
                  <span className="nexus-detail-label">Knowledge Bases:</span>
                  <span>{knowledgeSpaces.length} Spaces</span>
                </div>
              </div>

              {assistants.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Assistants in this Project:</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {assistants.map((a) => (
                      <span key={a.id} className="nexus-tag">
                        🤖 {a.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Project Modal */}
      {modalOpen && (
        <div className="nexus-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="nexus-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="nexus-modal-header">
              <h3>Create New Project</h3>
              <button type="button" className="nexus-close-btn" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate}>
              {errorMessage && <div className="nexus-form-error">{errorMessage}</div>}
              {successMessage && <div className="nexus-form-success">{successMessage}</div>}

              <div className="nexus-form-group">
                <label className="nexus-form-label">Project Name *</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. Infrastructure Engineering, Security Ops"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="nexus-form-group">
                <label className="nexus-form-label">Custom Slug (optional)</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. infra-eng (lowercase letters, numbers, hyphens)"
                  value={projectSlug}
                  onChange={(e) => setProjectSlug(e.target.value)}
                  disabled={isSubmitting}
                />
                <span className="nexus-form-hint">
                  Leave empty to automatically generate a unique slug.
                </span>
              </div>

              <div className="nexus-modal-actions">
                <button
                  type="button"
                  className="nexus-btn-ghost"
                  onClick={() => setModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="nexus-btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

