# NomaanOS Nexus AI — Universal Chat Widget Integration Guide

## Overview

The NomaanOS Nexus Chat Widget (`@nomaanos/nexus-widget`) is a high-performance, accessible, and embeddable React chat interface engineered to power conversational AI experiences across the entire NomaanOS ecosystem—from security consoles (Sentinel SOC) to developer portals and cloud operations dashboards.

### Core Capabilities
- **Universal Multi-Tenant Embedding**: One single widget build serves disparate NomaanOS web properties with isolated security boundaries.
- **Dual Packaging**:
  - Modern React component for SPA / SSR host applications (`import { NexusChatWidget } from '@nomaanos/nexus-widget'`).
  - Self-contained UMD bundle for zero-dependency HTML `<script>` tag embedding (`nexus-widget.umd.js`).
- **Dynamic Assistant Theming & Branding**: Configurable primary colors, dark/light/auto themes, custom avatars, greetings, and suggested prompt chips.
- **Dual Authentication Modes**:
  - **Public Guest Mode**: For documentation and public portals via cryptographically generated anonymous session tokens.
  - **Authenticated Mode**: For internal workspaces and consoles with Bearer JWT or HTTP-only session cookies.
  - **Strict Security & Anti-Prompt-Injection**: Browser clients cannot override system prompts, select arbitrary model profiles, or access foreign knowledge spaces.
- **Real-Time Streaming & Evidence Citations**: Server-Sent Events (SSE) streaming with interactive citation drawer displaying grounded source snippets.

---

## 1. Quick Start: Script Tag Embed (HTML / Vanilla JS)

For standard web pages, documentation sites (e.g., Hugo, Jekyll, Docusaurus), or non-React applications, embed the standalone bundle:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My NomaanOS Application</title>

  <!-- 1. Include the scoped widget stylesheet -->
  <link rel="stylesheet" href="http://localhost:4001/widget/style.css" />
</head>
<body>
  <h1>Welcome to NomaanOS</h1>

  <!-- 2. Auto-mount via declarative script attributes -->
  <script 
    src="http://localhost:4001/widget/nexus-widget.umd.js"
    data-api-base-url="http://localhost:4001"
    data-assistant-id="YOUR_ASSISTANT_UUID"
    data-theme-mode="auto"
    data-primary-color="#6366f1"
    data-title="Nexus AI Assistant"
    data-greeting="Hi! How can I help you today?"
    defer>
  </script>
</body>
</html>
```

### Programmatic Initialization

Alternatively, initialize or mount multiple instances dynamically using JavaScript:

```html
<script src="http://localhost:4001/widget/nexus-widget.umd.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    window.NexusWidget.init({
      apiBaseUrl: 'http://localhost:4001',
      assistantId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      authToken: 'Bearer eyJhbGciOi...', // Optional for authenticated assistants
      theme: {
        mode: 'dark',
        primaryColor: '#ef4444',
      },
      title: 'Sentinel Security AI',
      subtitle: 'SOC Autonomous Copilot',
      greeting: 'Sentinel AI online. Report incident identifiers or suspicious telemetry.',
      suggestedPrompts: [
        'Analyze IP 198.51.100.42 activity',
        'Review recent privilege escalation alerts',
        'Summarize containment playbooks'
      ],
      defaultOpen: false,
    });
  });
</script>
```

---

## 2. Quick Start: React Host Applications

Install the package from the private NomaanOS monorepo registry or workspace:

```bash
npm install @nomaanos/nexus-widget
```

Import and render the component inside your React 18+ application:

```tsx
import React from 'react';
import { NexusChatWidget } from '@nomaanos/nexus-widget';
import '@nomaanos/nexus-widget/dist/style.css';

export function App() {
  const currentAuthToken = useAuthToken(); // If authenticated

  return (
    <div className="app-container">
      <main>Your Application Content</main>

      <NexusChatWidget
        apiBaseUrl="http://localhost:4001"
        assistantId="768da6c3-1fbe-46e3-ae9e-1ceec8875631"
        authToken={currentAuthToken}
        theme={{
          mode: 'dark',
          primaryColor: '#6366f1',
        }}
        title="Developer Assistant"
        subtitle="Nexus API & SDK Guidance"
        greeting="Hi there! Ask me anything about Nexus SDK, APIs, or integration patterns."
        suggestedPrompts={[
          'How do I authenticate with Bearer tokens?',
          'What is the Server-Sent Events message format?',
          'How do I mount the widget in Next.js?',
        ]}
        position="bottom-right"
        defaultOpen={false}
      />
    </div>
  );
}
```

---

## 3. Configuration Reference

### `NexusChatWidgetProps`

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `apiBaseUrl` | `string` | `window.location.origin` | The root URL of the Nexus API service. |
| `assistantId` | `string` | *(Required)* | The UUID of the target Assistant. |
| `authToken` | `string` | `undefined` | Optional Bearer JWT for private, authenticated assistants. |
| `title` | `string` | Assistant Name | Header title override (falls back to assistant database name). |
| `subtitle` | `string` | `undefined` | Secondary header caption or context. |
| `greeting` | `string` | `undefined` | Initial message automatically presented to the user. |
| `avatarUrl` | `string` | `undefined` | Custom icon or image URL displayed in launcher and assistant bubbles. |
| `suggestedPrompts`| `string[]` | `[]` | Clickable prompt chips shown at the top of the conversation. |
| `theme` | `WidgetTheme` | `{ mode: 'auto' }` | Visual configuration (mode and primary accent color). |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Screen docking position for the floating widget. |
| `defaultOpen` | `boolean` | `false` | Whether the chat window renders expanded on initial load. |
| `className` | `string` | `undefined` | Optional top-level CSS class for host overrides. |

### `WidgetTheme`

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color mode (`auto` matches OS `prefers-color-scheme`). |
| `primaryColor` | `string` | `'#6366f1'` | Hex or CSS color string for brand accents and buttons. |

---

## 4. Multi-Tenant Security & Trust Boundaries

The Nexus Chat Widget is architected according to zero-trust principles. The client runs in an untrusted browser environment and must never be permitted to tamper with RAG context or access unpermitted data.

```
+--------------------------------------------------------------------------+
|                              UNTRUSTED BROWSER                           |
|                                                                          |
|   +------------------------------------------------------------------+   |
|   |                      Nexus Chat Widget                           |   |
|   |  - Assistant ID (UUID)                                           |   |
|   |  - Message content text                                          |   |
|   |  - X-Anonymous-Session-Token or Bearer Token                     |   |
|   |  * Cannot specify systemPrompt or model profile                  |   |
|   +------------------------------------------------------------------+   |
+--------------------------------------------------------------------------+
                                    |
                        HTTP / SSE (CORS Enforced)
                                    v
+--------------------------------------------------------------------------+
|                            NEXUS API SERVER                              |
|                                                                          |
|  1. Assistant Scoping:                                                   |
|     - Verify public embedding flag OR authenticate workspace membership  |
|     - Return 404 (Not Found) on unauthorized access to prevent probing   |
|                                                                          |
|  2. Server-Controlled Ingestion & System Prompt:                         |
|     - Resolve private system prompt strictly from Assistant record       |
|     - Resolve bound knowledge spaces & tenant vector partitions          |
|                                                                          |
|  3. Streaming & Citations:                                               |
|     - Stream tokens via Server-Sent Events                               |
|     - Emit verified document citations and snippet references            |
+--------------------------------------------------------------------------+
```

### Security Guarantees:
1. **Zero Client Prompt Injection**: System prompts, instructions, safety guardrails, and model temperatures are resolved strictly server-side from PostgreSQL. Any attempt by the client to supply prompt parameters is ignored.
2. **Anti-Enumeration on IDs**: When an unauthenticated user or an unauthorized tenant queries `GET /api/v1/assistants/:assistantId/config`, the API returns `404 Not Found` rather than `403 Forbidden`, preventing attackers from enumerating assistant UUIDs.
3. **Strict Session Isolation**: Public conversations use high-entropy anonymous session tokens (`X-Anonymous-Session-Token`). Messages cannot be read or appended across disparate anonymous sessions.
4. **Tenant Scoping for Knowledge Spaces**: Documents and vector embeddings are partitioned by `workspace_id`. Cross-tenant retrieval is strictly prohibited at the database query layer.

---

## 5. Real-Time Streaming & Citation Protocol

The widget communicates with the Nexus conversation pipeline using Server-Sent Events (SSE) over standard HTTP/2 or HTTP/1.1:

```http
POST /api/v1/conversations/:conversationId/messages
Accept: text/event-stream
Content-Type: application/json
X-Anonymous-Session-Token: anon_abc123...

{"content": "What is the recommended timeout setting?", "stream": true}
```

### Documented SSE Event Contracts

The API emits standardized, typed SSE events handled natively by the widget:

| Event Name | Purpose | Example Payload |
| :--- | :--- | :--- |
| `message.start` | Initializer containing assistant message identifier | `{"messageId":"msg_01","role":"assistant"}` |
| `text` | Incremental response text chunk | `{"delta":"The recommended timeout ","text":"The recommended timeout "}` |
| `tool_status` | Safe tool execution updates without leaking secrets | `{"tool":"knowledge_retrieval","status":"completed"}` |
| `citation` | Source evidence supporting response | `{"citations":[{"sourceTitle":"Proxy Manual","excerpt":"Set timeout to 30s."}]}` |
| `completion` | Terminal event indicating successful completion | `{"messageId":"msg_01","finishReason":"stop","usage":{"totalTokens":42}}` |
| `error` | Safe, sanitized error event | `{"error":"InferenceTimeout","message":"Upstream inference timed out."}` |

```http
event: message.start
data: {"messageId": "msg_01", "role": "assistant"}

event: tool_status
data: {"tool": "knowledge_retrieval", "status": "completed", "message": "Knowledge retrieval completed."}

event: text
data: {"delta": "The recommended timeout ", "text": "The recommended timeout "}

event: text
data: {"delta": "for gateway proxies is 30 seconds.", "text": "The recommended timeout for gateway proxies is 30 seconds."}

event: citation
data: {"citations": [{"citationIndex": 1, "sourceTitle": "Proxy Ops Manual", "excerpt": "Set proxy timeout to 30s.", "relevanceScore": 0.94}]}

event: completion
data: {"messageId": "msg_01", "finishReason": "stop", "usage": {"totalTokens": 42}}
```

### Cancellation and Disconnect Handling

- **Client Cancellation**: When a user clicks the Stop button in the widget or closes the browser tab, the widget aborts the underlying HTTP stream using `AbortController`.
- **Server Cleanup**: The API listens on `req.on('close')`. When an abort occurs, the server stops upstream token streaming and updates the assistant message in PostgreSQL to `finish_reason = 'cancelled'`, preserving the partial generated text without leaving orphaned locks.

---

## 6. Message Feedback & Evaluation

The widget supports interactive thumbs-up / thumbs-down evaluation on assistant responses:

```http
POST /api/v1/conversations/:conversationId/messages/:messageId/feedback
Content-Type: application/json
X-Anonymous-Session-Token: anon_abc123...

{
  "rating": "positive",
  "comment": "Extremely accurate security investigation response."
}
```

- **Supported Ratings**: `'positive'`, `'negative'`, `'thumbs_up'`, `'thumbs_down'` (normalized to positive/negative).
- **Optional Comment**: Up to 2,000 characters.
- **Conflict Policy**: Submitting feedback a second time updates the existing rating and comment (`ON CONFLICT DO UPDATE`), preventing duplicate entries.
- **Authorization**: Only the authorized user or anonymous session that owns the conversation can submit feedback on its messages.

---

## 7. Multi-Website Showcase (`apps/widget-demo`)

The repository includes a multi-website demonstration application (`apps/widget-demo`) illustrating the widget adapted to three distinct NomaanOS products:

1. **Sentinel SOC (Security Operations Console)**:
   - **Theme**: Dark high-contrast mode with Crimson accent (`#ef4444`).
   - **Context**: Threat analysis, IP reputation queries, incident remediation.
2. **Developer Documentation Portal**:
   - **Theme**: Auto light/dark mode with Indigo accent (`#6366f1`).
   - **Context**: API endpoint guidance, SDK code snippets, quick reference.
3. **Cloud Operations Dashboard**:
   - **Theme**: Dark console mode with Emerald accent (`#10b981`).
   - **Context**: Cluster health diagnostics, node scaling, log telemetry.

### Running the Demo Locally

```bash
# 1. Start the API service and database (if not already running)
npm run docker:up
npm run dev --prefix services/api

# 2. Start the widget demo application
npm run dev --prefix apps/widget-demo
```

Open `http://localhost:5173` in your browser to interact with the switcher and verify live widget behavior across all three tenant scenarios.
To inspect standalone script tag embedding, open `apps/widget-demo/standalone-example.html` directly in any web browser.

