import React, { useState, useEffect, useCallback } from 'react';
import { NexusChatWidget } from '@nomaanos/nexus-widget';
import '@nomaanos/nexus-widget/style.css';
import './demo.css';

import {
  NavigationTab,
  ShowcaseSubTab,
  WorkspaceSummary,
  AssistantSummary,
  KnowledgeSpaceSummary,
  PlatformHealth,
  WidgetCustomizationConfig,
} from './types';
import { api } from './services/api';

import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { ProjectsView } from './components/ProjectsView';
import { KnowledgeBasesView } from './components/KnowledgeBasesView';
import { AssistantsView } from './components/AssistantsView';
import { WidgetConfigView } from './components/WidgetConfigView';
import { PlaygroundView } from './components/PlaygroundView';
import { ShowcasesView } from './components/ShowcasesView';
import { AuthModal } from './components/AuthModal';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  const [activeShowcaseSite, setActiveShowcaseSite] = useState<ShowcaseSubTab>('sentinel');

  // Platform state
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(null);
  const [assistants, setAssistants] = useState<AssistantSummary[]>([]);
  const [knowledgeSpaces, setKnowledgeSpaces] = useState<KnowledgeSpaceSummary[]>([]);
  const [health, setHealth] = useState<PlatformHealth>({ status: 'offline' });
  const [apiConnected, setApiConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!api.getToken());

  // Interactive Widget Customizer Config
  const [widgetConfig, setWidgetConfig] = useState<WidgetCustomizationConfig>({
    assistantId: '',
    title: 'Nexus AI Copilot',
    primaryColor: '#06b6d4',
    darkMode: true,
    position: 'bottom-right',
    greetingMessage: 'How can I assist you with platform documentation today?',
    suggestedPrompts: [
      'How do I get started?',
      'Where can I find API credentials?',
      'How does document retrieval work?',
    ],
    apiBaseUrl: '',
  });

  // 1. Initial Health Check & Initial Load
  const checkHealthAndLoad = useCallback(async () => {
    try {
      const h = await api.checkHealth();
      setHealth(h);
      setApiConnected(h.status !== 'offline');
    } catch {
      setHealth({ status: 'offline' });
      setApiConnected(false);
    }
  }, []);

  // 2. Fetch Workspaces (Projects)
  const fetchWorkspaces = useCallback(async () => {
    if (!api.getToken()) {
      setWorkspaces([]);
      setActiveWorkspace(null);
      setAssistants([]);
      setKnowledgeSpaces([]);
      return;
    }

    setLoading(true);
    try {
      const wsList = await api.getWorkspaces();
      setWorkspaces(wsList);
      if (wsList.length > 0) {
        const currentActiveId = api.getActiveWorkspaceId();
        const found = wsList.find((w) => w.id === currentActiveId) || wsList[0];
        setActiveWorkspace(found);
        api.setActiveWorkspaceId(found.id);
      } else {
        setActiveWorkspace(null);
        api.setActiveWorkspaceId(null);
      }
    } catch (err) {
      console.warn('Failed to fetch workspaces from API, using cached state', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 3. Fetch Scoped Resources (Assistants & Knowledge Spaces) for Active Workspace
  const fetchWorkspaceResources = useCallback(async (wsId: string) => {
    setLoading(true);
    try {
      const [asstList, ksList] = await Promise.allSettled([
        api.getAssistants(wsId),
        api.getKnowledgeSpaces(wsId),
      ]);

      if (asstList.status === 'fulfilled') {
        setAssistants(asstList.value);
        if (asstList.value.length > 0) {
          // Sync active assistant with widget config
          const currentAsst = asstList.value[0];
          setWidgetConfig((prev) => ({
            ...prev,
            assistantId: currentAsst.id,
            title: currentAsst.name,
            primaryColor: (currentAsst.theme as any)?.primaryColor || prev.primaryColor,
            darkMode: (currentAsst.theme as any)?.darkMode ?? prev.darkMode,
          }));
        }
      }

      if (ksList.status === 'fulfilled') {
        setKnowledgeSpaces(ksList.value);
      }
    } catch (err) {
      console.warn('Failed to fetch workspace resources', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkHealthAndLoad();
    fetchWorkspaces();
  }, [checkHealthAndLoad, fetchWorkspaces]);

  useEffect(() => {
    if (activeWorkspace) {
      fetchWorkspaceResources(activeWorkspace.id);
    }
  }, [activeWorkspace, fetchWorkspaceResources]);

  // Project Selection Handler
  const handleSelectWorkspace = (workspaceId: string) => {
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (ws) {
      setActiveWorkspace(ws);
      api.setActiveWorkspaceId(ws.id);
    }
  };

  // Create Project Handler
  const handleCreateWorkspace = async (name: string, slug?: string) => {
    if (!api.getToken()) {
      setAuthModalOpen(true);
      throw new Error('Authentication required. Please sign in or register to create a project.');
    }
    const newWs = await api.createWorkspace(name, slug);
    setWorkspaces((prev) => [newWs, ...prev]);
    setActiveWorkspace(newWs);
    api.setActiveWorkspaceId(newWs.id);
  };

  // Create Assistant Handler
  const handleCreateAssistant = async (data: any) => {
    if (!api.getToken()) {
      setAuthModalOpen(true);
      throw new Error('Authentication required. Please sign in to create an assistant persona.');
    }
    if (!activeWorkspace) throw new Error('No active project selected.');
    const newAsst = await api.createAssistant(activeWorkspace.id, data);
    setAssistants((prev) => [newAsst, ...prev]);
    setWidgetConfig((prev) => ({
      ...prev,
      assistantId: newAsst.id,
      title: newAsst.name,
      primaryColor: (newAsst.theme as any)?.primaryColor || prev.primaryColor,
      darkMode: (newAsst.theme as any)?.darkMode ?? prev.darkMode,
      position: (newAsst.theme as any)?.position || prev.position,
      greetingMessage: newAsst.greeting_message || prev.greetingMessage,
    }));
  };

  // Update Assistant Handler
  const handleUpdateAssistant = async (assistantId: string, data: any) => {
    if (!api.getToken()) {
      setAuthModalOpen(true);
      throw new Error('Authentication required. Please sign in to modify assistants.');
    }
    if (!activeWorkspace) throw new Error('No active project selected.');
    const updated = await api.updateAssistant(activeWorkspace.id, assistantId, data);
    setAssistants((prev) => prev.map((a) => (a.id === assistantId ? updated : a)));
    setWidgetConfig((prev) => {
      if (prev.assistantId === assistantId) {
        return {
          ...prev,
          title: updated.name,
          primaryColor: (updated.theme as any)?.primaryColor || prev.primaryColor,
          darkMode: (updated.theme as any)?.darkMode ?? prev.darkMode,
          position: (updated.theme as any)?.position || prev.position,
          greetingMessage: updated.greeting_message || prev.greetingMessage,
        };
      }
      return prev;
    });
  };

  // Delete Assistant Handler
  const handleDeleteAssistant = async (assistantId: string) => {
    if (!api.getToken()) {
      setAuthModalOpen(true);
      throw new Error('Authentication required. Please sign in.');
    }
    if (!activeWorkspace) throw new Error('No active project selected.');
    await api.deleteAssistant(activeWorkspace.id, assistantId);
    setAssistants((prev) => prev.filter((a) => a.id !== assistantId));
  };

  // Create Knowledge Space Handler
  const handleCreateKnowledgeSpace = async (data: any) => {
    if (!api.getToken()) {
      setAuthModalOpen(true);
      throw new Error('Authentication required. Please sign in to create a knowledge base.');
    }
    if (!activeWorkspace) throw new Error('No active project selected.');
    const newKs = await api.createKnowledgeSpace(activeWorkspace.id, data);
    setKnowledgeSpaces((prev) => [newKs, ...prev]);
  };

  // Auth Handlers
  const handleLogin = async (email: string, pass: string) => {
    const res = await api.login(email, pass);
    setIsLoggedIn(true);
    if (res.workspaces) {
      setWorkspaces(res.workspaces);
      if (res.workspaces.length > 0) {
        setActiveWorkspace(res.workspaces[0]);
      }
    }
    await checkHealthAndLoad();
  };

  const handleRegister = async (data: any) => {
    const res = await api.register(data);
    setIsLoggedIn(true);
    if (res.workspace) {
      setWorkspaces([res.workspace]);
      setActiveWorkspace(res.workspace);
    }
    await checkHealthAndLoad();
  };

  const handleLogout = () => {
    api.setToken(null);
    setIsLoggedIn(false);
    fetchWorkspaces();
  };

  const handleSelectShowcaseSite = (site: ShowcaseSubTab) => {
    setActiveShowcaseSite(site);
    if (site === 'sentinel') {
      setWidgetConfig((prev) => ({
        ...prev,
        title: 'Sentinel Cyber Copilot',
        primaryColor: '#06b6d4',
        darkMode: true,
        position: 'bottom-right',
      }));
    } else if (site === 'docs') {
      setWidgetConfig((prev) => ({
        ...prev,
        title: 'Developer Documentation AI',
        primaryColor: '#3b82f6',
        darkMode: false,
        position: 'bottom-right',
      }));
    } else if (site === 'cloud') {
      setWidgetConfig((prev) => ({
        ...prev,
        title: 'Cloud Fleet Assistant',
        primaryColor: '#10b981',
        darkMode: true,
        position: 'bottom-left',
      }));
    }
  };

  return (
    <div className="nexus-app-root">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        health={health}
        isLoggedIn={isLoggedIn}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main View Router */}
      <main className="nexus-main-content">
        {activeTab === 'dashboard' && (
          <DashboardView
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            assistants={assistants}
            knowledgeSpaces={knowledgeSpaces}
            health={health}
            onNavigate={setActiveTab}
            onOpenCreateProject={() => setActiveTab('projects')}
            onOpenCreateAssistant={() => setActiveTab('assistants')}
            apiConnected={apiConnected}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsView
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
            assistants={assistants}
            knowledgeSpaces={knowledgeSpaces}
            loading={loading}
          />
        )}

        {activeTab === 'knowledge-bases' && (
          <KnowledgeBasesView
            knowledgeSpaces={knowledgeSpaces}
            activeWorkspace={activeWorkspace}
            workspaces={workspaces}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateKnowledgeSpace={handleCreateKnowledgeSpace}
            loading={loading}
          />
        )}

        {activeTab === 'assistants' && (
          <AssistantsView
            assistants={assistants}
            knowledgeSpaces={knowledgeSpaces}
            activeWorkspace={activeWorkspace}
            workspaces={workspaces}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateAssistant={handleCreateAssistant}
            onUpdateAssistant={handleUpdateAssistant}
            onDeleteAssistant={handleDeleteAssistant}
            onSelectForWidgetConfig={(asst) => {
              setWidgetConfig((prev) => ({
                ...prev,
                assistantId: asst.id,
                title: asst.name,
                primaryColor: (asst.theme as any)?.primaryColor || prev.primaryColor,
                darkMode: (asst.theme as any)?.darkMode ?? prev.darkMode,
                position: (asst.theme as any)?.position || prev.position,
                greetingMessage: asst.greeting_message || prev.greetingMessage,
              }));
              setActiveTab('widget-config');
            }}
            onSelectForPlayground={(asst) => {
              setWidgetConfig((prev) => ({
                ...prev,
                assistantId: asst.id,
                title: asst.name,
                primaryColor: (asst.theme as any)?.primaryColor || prev.primaryColor,
                darkMode: (asst.theme as any)?.darkMode ?? prev.darkMode,
                position: (asst.theme as any)?.position || prev.position,
                greetingMessage: asst.greeting_message || prev.greetingMessage,
              }));
              setActiveTab('playground');
            }}
            loading={loading}
          />
        )}

        {activeTab === 'widget-config' && (
          <WidgetConfigView
            assistants={assistants}
            knowledgeSpaces={knowledgeSpaces}
            activeWorkspace={activeWorkspace}
            config={widgetConfig}
            onChangeConfig={setWidgetConfig}
            onOpenPlayground={() => setActiveTab('playground')}
            onSaveAssistantConfig={handleUpdateAssistant}
          />
        )}

        {activeTab === 'playground' && (
          <PlaygroundView
            config={widgetConfig}
            assistants={assistants}
            activeWorkspace={activeWorkspace}
            onSelectAssistant={(asst) => {
              setWidgetConfig((prev) => ({
                ...prev,
                assistantId: asst.id,
                title: asst.name,
              }));
            }}
          />
        )}

        {activeTab === 'showcases' && (
          <ShowcasesView
            activeSite={activeShowcaseSite}
            onSelectSite={handleSelectShowcaseSite}
            currentAssistantId={widgetConfig.assistantId}
          />
        )}
      </main>

      {/* Universal Nexus Chat Widget - Mounted when active assistant is configured */}
      {widgetConfig.assistantId ? (
        <NexusChatWidget
          key={`${widgetConfig.assistantId}-${widgetConfig.position}-${widgetConfig.darkMode}`}
          assistantId={widgetConfig.assistantId}
          apiBaseUrl={widgetConfig.apiBaseUrl}
          title={widgetConfig.title}
          themeOverrides={{
            primaryColor: widgetConfig.primaryColor,
            darkMode: widgetConfig.darkMode,
          }}
          position={widgetConfig.position}
          initialOpen={activeTab === 'playground'}
        />
      ) : null}

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    </div>
  );
};