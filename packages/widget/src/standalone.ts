import React from 'react';
import ReactDOM from 'react-dom/client';
import { NexusChatWidget } from './NexusChatWidget.js';
import type { NexusChatWidgetProps } from './types.js';

let widgetRoot: ReactDOM.Root | null = null;
let containerEl: HTMLElement | null = null;

export const version = '0.1.0';

/**
 * Initializes and mounts the Nexus Chat Widget into the DOM.
 */
export function init(props: NexusChatWidgetProps): void {
  if (typeof document === 'undefined') return;

  // If already mounted, unmount first
  destroy();

  containerEl = document.getElementById('nexus-chat-widget-root');
  if (!containerEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'nexus-chat-widget-root';
    document.body.appendChild(containerEl);
  }

  widgetRoot = ReactDOM.createRoot(containerEl);
  widgetRoot.render(React.createElement(NexusChatWidget, props));
}

/**
 * Destroys and unmounts the active widget instance.
 */
export function destroy(): void {
  if (widgetRoot) {
    widgetRoot.unmount();
    widgetRoot = null;
  }
  if (containerEl && containerEl.parentNode) {
    containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  }
}

// Global window exposure for UMD script tag consumers
if (typeof window !== 'undefined') {
  (window as any).NexusWidget = {
    version,
    init,
    destroy,
  };

  // Auto-detect and initialize from <script data-assistant-id="..."> if present
  document.addEventListener('DOMContentLoaded', () => {
    const scripts = document.querySelectorAll('script[data-assistant-id]');
    if (scripts.length > 0) {
      const activeScript = scripts[scripts.length - 1] as HTMLScriptElement;
      const assistantId = activeScript.getAttribute('data-assistant-id');
      const apiBaseUrl = activeScript.getAttribute('data-api-base-url') || undefined;
      const authToken = activeScript.getAttribute('data-auth-token') || undefined;
      const knowledgeSpaceId = activeScript.getAttribute('data-knowledge-space-id') || undefined;
      const hostApp = activeScript.getAttribute('data-host-application') || undefined;
      const position = (activeScript.getAttribute('data-position') as any) || 'bottom-right';
      const initialOpen = activeScript.getAttribute('data-initial-open') === 'true';

      if (assistantId) {
        init({
          assistantId,
          apiBaseUrl,
          authToken,
          knowledgeSpaceId,
          hostApplication: hostApp,
          position,
          initialOpen,
        });
      }
    }
  });
}

