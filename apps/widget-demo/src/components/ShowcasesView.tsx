import React, { useState } from 'react';
import { ShowcaseSubTab } from '../types';

interface ShowcasesViewProps {
  onSelectSite: (site: ShowcaseSubTab) => void;
  activeSite: ShowcaseSubTab;
  currentAssistantId: string;
}

export const ShowcasesView: React.FC<ShowcasesViewProps> = ({
  onSelectSite,
  activeSite,
  currentAssistantId,
}) => {
  return (
    <div className="nexus-view-container">
      {/* Sub-navigation bar for the 3 showcases */}
      <div className="nexus-showcase-subnav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Showcase Environment:</span>
          <div className="nexus-tabs-sub">
            <button
              type="button"
              className={`nexus-tab-sub-btn ${activeSite === 'sentinel' ? 'active' : ''}`}
              onClick={() => onSelectSite('sentinel')}
            >
              🛡️ Sentinel SOC
            </button>
            <button
              type="button"
              className={`nexus-tab-sub-btn ${activeSite === 'docs' ? 'active' : ''}`}
              onClick={() => onSelectSite('docs')}
            >
              📚 Developer Docs
            </button>
            <button
              type="button"
              className={`nexus-tab-sub-btn ${activeSite === 'cloud' ? 'active' : ''}`}
              onClick={() => onSelectSite('cloud')}
            >
              ☁️ Cloud Operations
            </button>
          </div>
        </div>
      </div>

      {/* Main Website Simulation Content */}
      <div style={{ marginTop: 16 }}>
        {activeSite === 'sentinel' && (
          <div className="site-content site-sentinel">
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
              <div className="site-banner">
                <span className="site-banner-icon">🛡️</span>
                <div>
                  <h1 className="site-title">NomaanOS Sentinel — Security Operations Center</h1>
                  <p className="site-subtitle">
                    Real-time enterprise threat monitoring, SIEM telemetry, and incident triage.
                  </p>
                </div>
              </div>

              <div className="sentinel-grid">
                <div className="sentinel-card">
                  <h3 style={{ margin: '0 0 16px 0', color: '#06b6d4' }}>🚨 Active Threat Incidents</h3>
                  <div className="sentinel-alert-item">
                    <div>
                      <strong>SSH Brute-Force Wave</strong>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>Target: web-prod-01 (14 attempts)</div>
                    </div>
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>HIGH</span>
                  </div>
                  <div className="sentinel-alert-item" style={{ borderLeftColor: '#f59e0b' }}>
                    <div>
                      <strong>Suspicious Sudo Execution</strong>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>User: deployer-svc (nopasswd)</div>
                    </div>
                    <span style={{ color: '#f59e0b', fontWeight: 700 }}>MEDIUM</span>
                  </div>
                </div>

                <div className="sentinel-card">
                  <h3 style={{ margin: '0 0 16px 0', color: '#06b6d4' }}>🔍 Universal Widget Integration</h3>
                  <p style={{ fontSize: 13, color: '#cbd5e1' }}>
                    The <strong>Sentinel Cyber Copilot</strong> widget is mounted in the bottom-right corner.
                    It provides automated investigation playbooks and incident triage directly into Sentinel.
                  </p>
                  <div className="snippet-box">
                    {`<NexusChatWidget\n  assistantId="${currentAssistantId}"\n  title="Sentinel Cyber Copilot"\n  themeOverrides={{ primaryColor: '#06b6d4', darkMode: true }}\n  position="bottom-right"\n/>`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSite === 'docs' && (
          <div className="site-content site-docs">
            <div className="docs-layout">
              <aside className="docs-sidebar">
                <h3 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#334155' }}>Documentation</h3>
                <ul>
                  <li className="active">Getting Started</li>
                  <li>Widget Installation</li>
                  <li>Authentication & Tokens</li>
                  <li>RAG Hybrid Retrieval</li>
                  <li>Inference Routing</li>
                </ul>
              </aside>

              <article>
                <h1 className="site-title" style={{ marginTop: 0 }}>Embed Nexus AI Chat Widget in Any Website</h1>
                <p style={{ color: '#64748b', fontSize: 15 }}>
                  NomaanOS Nexus AI provides a lightweight, embeddable React chat widget and standalone script bundle
                  designed to run seamlessly across all ecosystem applications.
                </p>

                <h2>Method 1: Standalone Script Embed (Zero Dependencies)</h2>
                <p>Copy and paste this snippet right before your <code>&lt;/body&gt;</code> closing tag:</p>
                <div className="snippet-box" style={{ background: '#1e293b' }}>
                  {`<script\n  src="http://localhost:4001/widget/nexus-widget.umd.js"\n  data-assistant-id="${currentAssistantId}"\n  data-api-base-url="http://localhost:4001"\n  async>\n</script>`}
                </div>

                <h2>Method 2: React Component Package</h2>
                <p>For modern Single Page Applications (Next.js, Vite, Remix):</p>
                <div className="snippet-box" style={{ background: '#1e293b' }}>
                  {`import { NexusChatWidget } from '@nomaanos/nexus-widget';\nimport '@nomaanos/nexus-widget/style.css';\n\nexport function MyApp() {\n  return (\n    <NexusChatWidget\n      assistantId="${currentAssistantId}"\n      apiBaseUrl="http://localhost:4001"\n      themeOverrides={{ primaryColor: '#3b82f6', darkMode: false }}\n    />\n  );\n}`}
                </div>
              </article>
            </div>
          </div>
        )}

        {activeSite === 'cloud' && (
          <div className="site-content site-cloud">
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
              <div className="site-banner">
                <span className="site-banner-icon">☁️</span>
                <div>
                  <h1 className="site-title">NomaanOS Cloud — Infrastructure Platform</h1>
                  <p className="site-subtitle">
                    Cluster metrics, container orchestration, and server fleet health.
                  </p>
                </div>
              </div>

              <div className="cloud-metrics-row">
                <div className="cloud-metric-card">
                  <div>Active Nodes</div>
                  <div className="cloud-metric-value">48 / 48</div>
                </div>
                <div className="cloud-metric-card">
                  <div>CPU Utilization</div>
                  <div className="cloud-metric-value">34.2%</div>
                </div>
                <div className="cloud-metric-card">
                  <div>PostgreSQL Replicas</div>
                  <div className="cloud-metric-value">3 Healthy</div>
                </div>
              </div>

              <div style={{ marginTop: 28, background: 'rgba(16, 185, 129, 0.05)', padding: 24, borderRadius: 14, border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <h3 style={{ margin: 0, color: '#34d399' }}>Positioning & Branding Customization</h3>
                <p style={{ color: '#cbd5e1', fontSize: 14 }}>
                  Notice that in the Cloud Platform view, the chat widget is positioned on the <strong>bottom-left</strong> (to avoid overlapping floating system status docks) with an <strong>emerald green</strong> theme.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

