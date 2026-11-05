import React, { useState } from 'react';
import { NavigationTab, PlatformHealth, WorkspaceSummary } from '../types';

interface NavbarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  onSelectWorkspace: (workspaceId: string) => void;
  health: PlatformHealth;
  isLoggedIn: boolean;
  onOpenAuthModal: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  health,
  isLoggedIn,
  onOpenAuthModal,
  onLogout,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const tabs: { id: NavigationTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'projects', label: 'Projects', icon: '📁' },
    { id: 'knowledge-bases', label: 'Knowledge Bases', icon: '📚' },
    { id: 'assistants', label: 'Assistants', icon: '🤖' },
    { id: 'widget-config', label: 'Widget Config', icon: '🎨' },
    { id: 'playground', label: 'Playground', icon: '🧪' },
    { id: 'showcases', label: 'Demo Showcases', icon: '🌐' },
  ];

  const getStatusColor = () => {
    if (health.status === 'healthy') return '#10b981';
    if (health.status === 'degraded') return '#f59e0b';
    return '#ef4444';
  };

  const getStatusLabel = () => {
    if (health.status === 'healthy') return `Online (${health.provider || 'local'})`;
    if (health.status === 'degraded') return 'Degraded';
    return 'Backend Offline';
  };

  return (
    <header className="nexus-nav-root">
      <div className="nexus-nav-container">
        {/* Brand */}
        <div className="nexus-nav-brand" onClick={() => onSelectTab('dashboard')} style={{ cursor: 'pointer' }}>
          <span className="nexus-brand-badge">⚡</span>
          <div className="nexus-brand-text">
            <span className="nexus-brand-title">NomaanOS Nexus AI</span>
            <span className="nexus-brand-subtitle">Documentation AI Platform</span>
          </div>
        </div>

        {/* Project Switcher */}
        {workspaces.length > 0 && (
          <div className="nexus-nav-workspace-picker">
            <label htmlFor="workspace-select" className="nexus-picker-label">Project:</label>
            <select
              id="workspace-select"
              className="nexus-picker-select"
              value={activeWorkspace?.id || ''}
              onChange={(e) => onSelectWorkspace(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({ws.role || 'member'})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Desktop Navigation Tabs */}
        <nav className="nexus-nav-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nexus-nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                onSelectTab(tab.id);
                setMobileMenuOpen(false);
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Right Actions: Health + Auth */}
        <div className="nexus-nav-actions">
          <div
            className="nexus-status-pill"
            title={health.activeModel ? `Active Model: ${health.activeModel}` : 'API Status'}
          >
            <span className="nexus-status-dot" style={{ backgroundColor: getStatusColor() }} />
            <span className="nexus-status-text">{getStatusLabel()}</span>
          </div>

          {isLoggedIn ? (
            <button type="button" className="nexus-btn-ghost" onClick={onLogout} title="Sign Out">
              Sign Out
            </button>
          ) : (
            <button type="button" className="nexus-btn-primary" onClick={onOpenAuthModal}>
              Sign In
            </button>
          )}

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            className="nexus-hamburger-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle Navigation"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="nexus-mobile-menu">
          {workspaces.length > 0 && (
            <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                Active Project
              </label>
              <select
                className="nexus-picker-select"
                style={{ width: '100%' }}
                value={activeWorkspace?.id || ''}
                onChange={(e) => {
                  onSelectWorkspace(e.target.value);
                  setMobileMenuOpen(false);
                }}
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name} ({ws.role || 'member'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="nexus-mobile-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`nexus-mobile-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => {
                  onSelectTab(tab.id);
                  setMobileMenuOpen(false);
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};

