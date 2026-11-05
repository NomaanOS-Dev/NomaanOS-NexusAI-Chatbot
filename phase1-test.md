# NomaanOS Nexus AI — Phase 1 Visual & Manual Testing Guide
**Document Version:** 1.0.0  
**Phase Coverage:** Days 1 through 5 (Foundation, Database, Security & Isolation, Universal Widget, Chat Streaming & History)  
**Target Environments:** Local Development (`http://localhost:5173` & `http://localhost:4001`)

---

## 1. Overview & Objective

This manual testing guide enables you to visually and interactively verify **every Phase 1 capability** of NomaanOS Nexus AI directly in your web browser. 

### Phase 1 Features Verified in this Test:
1. **Multi-Host Website Simulation**: Seamless dynamic brand switching across three distinct host platforms (Sentinel SOC, Developer Docs, Cloud Operations).
2. **Adaptive Theming & Custom Positioning**: Real-time theme injection (cyan/dark, royal blue/light, emerald/dark) and positional shifting (`bottom-right` vs `bottom-left`).
3. **Mobile & Viewport Responsiveness**: Pixel-perfect rendering across 390px (mobile), 768px (tablet), and 1440px (desktop) with zero overflow.
4. **Interactive Widget Lifecycle**: Launcher button toggle, greeting banner, suggested prompt pills, dynamic avatars, and status badges.
5. **Real-Time SSE Streaming**: Sub-100ms chunk streaming (`event: text`, `event: tool_status`, `event: citation`, `event: completion`).
6. **Tool Execution Status**: Interactive pill showing backend knowledge retrieval execution.
7. **Grounded Citations Drawer**: Interactive citations badges with excerpt drawers, source metadata, and relevance scores.
8. **Interactive User Feedback**: Thumbs-up / thumbs-down buttons with real-time UI feedback and backend persistence.
9. **Streaming Cancellation (Stop Generation)**: Aborting upstream SSE stream mid-generation with partial token retention.
10. **Conversation History Persistence**: Re-opening widget and hard page refreshing to verify conversation restoration.
11. **Tenant Isolation & Security Boundaries**: Public vs. private assistant boundaries and strict cross-workspace isolation.

---

## 2. Pre-Flight Setup & Environment Launch

Open two terminal windows (PowerShell or Bash) in the project root: `d:\Projects\8-NomaanOS-Nexus-AI`.

### Step 2.1: Verify Docker Database
Ensure the PostgreSQL 16 + pgvector container is running on port `5434`:
```powershell
npm.cmd run db:up
```
*Expected Output:* Container `nomaanos-nexus-database` is started or running.

### Step 2.2: Apply Migrations & Seed Demo Showcase Data
Run the migration suite followed by the showcase seed:
```powershell
npm.cmd run db:migrate
npm.cmd run db:seed
```
*Expected Output:*
```text
Migration execution completed
Successfully seeded showcase assistants:
┌─────────┬────────────────────────────────────────┬──────────────────────────────┬──────────────────────┬──────────┐
│ (index) │ id                                     │ name                         │ public_embed_allowed │ status   │
├─────────┼────────────────────────────────────────┼──────────────────────────────┼──────────────────────┼──────────┤
│ 0       │ '4f9d1462-8321-4f11-8be8-2d83ba32d1e0' │ 'Sentinel Cyber Copilot'     │ true                 │ 'active' │
│ 1       │ '91a82f04-8b1e-4509-a1b4-ff70f7d4e320' │ 'Nexus Documentation Guide'  │ true                 │ 'active' │
│ 2       │ 'e81a9f04-1111-4509-a1b4-ff70f7d4e320' │ 'Cloud Operations Assistant' │ true                 │ 'active' │
└─────────┴────────────────────────────────────────┴──────────────────────────────┴──────────────────────┴──────────┘
```

### Step 2.3: Start the Backend API Server
In **Terminal 1**, run:
```powershell
npm.cmd run dev:api
```
*Expected Output:*
```text
Server listening at http://127.0.0.1:4001
[Nexus AI API] Ready and initialized on port 4001
```

Verify backend health in your browser or curl:
- `http://localhost:4001/health` ➔ `{"status":"ok","timestamp":"..."}`
- `http://localhost:4001/ready` ➔ `{"status":"ready","database":"connected"}`

### Step 2.4: Start the Showcase Demo Application
In **Terminal 2**, start the Vite dev server:
```powershell
npm.cmd run dev --workspace=apps/widget-demo
```
*Expected Output:*
```text
  VITE v5.4.21  ready in ~250 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Now open **`http://localhost:5173`** in Google Chrome, Microsoft Edge, or Firefox.

---

## 3. Visual Test Suite Walkthrough

Follow the 9 test scenarios below in your browser.

---

### Scenario 1: Multi-Host Brand Showcase & Theme Switching
**Objective:** Verify that switching between the three host websites dynamically reconfigures the widget styling, positioning, and persona without page reloads.

#### Test 1.1: Sentinel SOC (Security Operations Center)
1. In the top showcase navigation bar, click the **🛡️ Sentinel SOC** tab.
2. **Observe Host Page:**
   - Background is deep dark navy (`#080e1a`).
   - Metrics cards display "Active Threats (0 Critical)", "SIEM Ingestion (48.2k eps)".
3. **Observe Widget Trigger:**
   - Positioned at **bottom-right** of the viewport.
   - Glowing **Cyan accent** (`#06b6d4`) floating trigger button with a message bubble icon.
4. **Open Widget:**
   - Click the cyan floating trigger button.
   - The modal chat container slides open smoothly.
   - Header title shows **"Sentinel Cyber Copilot"**.
   - Subtitle shows **"nomaanos-sentinel"** with an active green status dot.
   - Greeting message bubble: *"Greetings, Operator. Sentinel Cyber Copilot is online. How can I assist with threat triage or SOC telemetry today?"*
   - Three cyber-specific prompt pills appear below greeting.

#### Test 1.2: Developer Docs (Clean White Technical Theme)
1. In the top showcase navigation bar, click the **📚 Developer Docs** tab.
2. **Observe Host Page:**
   - Background instantly transitions to clean light gray/white (`#f8fafc`).
   - Left documentation sidebar displays "Quick Start", "Embedding Guide", "API Reference".
3. **Observe Widget Trigger:**
   - Positioned at **bottom-right**.
   - Color transitions from cyan to **Royal Blue** (`#3b82f6`).
4. **Open Widget:**
   - Click the blue trigger button.
   - Chat window opens with a bright, crisp **light mode** theme.
   - Header shows **"Nexus Documentation Guide"** with blue accent header.
   - Greeting: *"Hello developer! I am your Nexus AI Documentation Guide. What integration or API questions can I answer?"*

#### Test 1.3: Cloud Operations (Emerald Theme & Bottom-Left Positioning)
1. In the top showcase navigation bar, click the **☁️ Cloud Operations** tab.
2. **Observe Host Page:**
   - Background switches to rich dark charcoal/green tint (`#091712`).
   - Metric cards display "Cluster Health (99.98%)", "Kubernetes Pods (128 Healthy)".
3. **Observe Widget Trigger:**
   - **Crucial check:** The floating widget trigger moves to the **bottom-left** of the screen!
   - Accent color transitions to **Emerald Green** (`#10b981`).
4. **Open Widget:**
   - Click the emerald trigger button on the bottom-left.
   - Chat window docks to the bottom-left.
   - Title: **"Cloud Operations Assistant"**.
   - Greeting: *"System monitoring active. Cloud Operations Assistant ready. Which infrastructure metrics or cluster events need review?"*

✅ **Acceptance Check:** Each host application renders its distinct color accent, light/dark mode, and custom position without CSS conflicts or page refreshes.

---

### Scenario 2: Mobile Responsiveness & Viewport Inspection
**Objective:** Verify that the host layout and chat widget adapt seamlessly across mobile (390px), tablet (768px), and desktop (1440px) viewports with zero horizontal clipping.

#### Test 2.1: Mobile Phone (390px — iPhone 12/13/14)
1. Open Chrome/Edge DevTools (`F12` or `Ctrl+Shift+I`).
2. Click the **Device Toggle Toolbar** icon (`Ctrl+Shift+M`).
3. Select **iPhone 12 Pro** or set dimension to **`390 x 844`**.
4. **Inspect Top Showcase Header:**
   - The brand title and 3 navigation buttons stack vertically or wrap cleanly.
   - No buttons clip or extend outside the 390px boundary.
   - The active button remains clearly highlighted.
5. **Inspect Developer Docs Site at 390px:**
   - Switch to **📚 Developer Docs** tab.
   - Verify the sidebar stacks neatly above the content instead of causing horizontal overflow.
   - Verify the code snippets (`<script src="...">`) have horizontal scrolling enabled without breaking page width.
6. **Inspect Widget at 390px:**
   - Click the widget trigger.
   - The chat window expands responsively to fit `calc(100vw - 32px)` with comfortable 16px margins on both left and right.
   - The close button (`✕`) is accessible at top-right.
   - The text area and send button are fully within view without pushing content offscreen.

#### Test 2.2: Tablet View (768px — iPad)
1. Change dimensions to **`768 x 1024`**.
2. Verify metric cards arrange into a balanced 2-column or 3-column grid.
3. Verify widget appears anchored comfortably in the corner with 24px viewport padding.

#### Test 2.3: Wide Desktop (1440px)
1. Change dimensions to **`1440 x 900`** or disable device toolbar.
2. Verify centered content container (max-width: 1100px) with clean margins.

✅ **Acceptance Check:** Horizontal scrollbar is completely absent (`overflow-x: hidden`). All UI elements scale without clipped text or overlapping buttons.

---

### Scenario 3: Real-Time SSE Message Streaming
**Objective:** Verify sub-100ms real-time chunk streaming with Server-Sent Events.

1. Ensure the API server is running on `http://localhost:4001`.
2. On any demo site (e.g. **Sentinel SOC**), open the chat widget.
3. Click the first suggested prompt pill:
   - *"Analyze threat telemetry for anomaly alert #9021"*
4. **Observe the immediate UI transitions:**
   - The message appears instantly in a user bubble on the right.
   - The input textarea is cleared.
   - The **Send button** (paper airplane icon) instantly flips into a red **Stop button** (square icon).
   - An active tool pill appears: `⚙️ Knowledge retrieval completed.`
   - Words stream into the assistant bubble smoothly chunk-by-chunk in real-time.
   - When streaming finishes:
     - Stop button returns to the Send button.
     - Assistant status badge shows "Ready".

✅ **Acceptance Check:** Text appears progressively token-by-token rather than popping in all at once after a long delay.

---

### Scenario 4: Grounded Knowledge Citations Drawer
**Objective:** Verify that knowledge base citations are retrieved and render expandable source evidence.

1. In the chat from Scenario 3, look at the bottom of the completed assistant response bubble.
2. **Observe Citation Pill:**
   - A clickable citation badge appears:  
     `📚 [1] Sentinel Incident Response Playbook v4.2`
3. **Click the Citation Pill:**
   - An evidence drawer slides open beneath the message.
   - The drawer displays:
     - **Source Title:** `Sentinel Incident Response Playbook v4.2`
     - **Relevance Score:** `92% match`
     - **Excerpt:** *"Sentinel SOC Playbook Section 4: Telemetry anomalies with severity level HIGH require immediate containment. Ingress filtering must be applied within 5 minutes of automated triage alert."*
4. Click the badge again to collapse the drawer.

✅ **Acceptance Check:** Citations are formatted cleanly, link to the seeded knowledge source, and expand/collapse smoothly.

---

### Scenario 5: User Message Feedback (Thumbs Up / Thumbs Down)
**Objective:** Verify interactive rating submission with backend persistence.

1. Hover your mouse over the completed assistant message (or look directly beneath the bubble).
2. You will see two feedback action buttons: **👍 (Thumbs Up)** and **👎 (Thumbs Down)**.
3. Open DevTools **Network tab** (filter by `Fetch/XHR`).
4. Click **👍 (Thumbs Up)**:
   - The thumb icon highlights in **emerald green**.
   - An outgoing request is visible in DevTools:
     - **Method:** `POST`
     - **Endpoint:** `http://localhost:4001/api/v1/conversations/<id>/messages/<id>/feedback`
     - **Status:** `200 OK` or `201 Created`
     - **Payload:** `{"rating": "positive"}`
5. Now click **👎 (Thumbs Down)**:
   - The thumbs-up highlight clears and the thumbs-down icon highlights in **rose red**.
   - A subsequent request submits `{"rating": "negative"}` and persists the updated rating.

✅ **Acceptance Check:** Feedback buttons update immediately in the UI and persist changes in PostgreSQL table `message_feedback`.

---

### Scenario 6: Mid-Generation Cancellation ("Stop" Button)
**Objective:** Verify that a user can abort an active AI generation mid-stream.

1. In the chat widget input box, type:
   - `"Provide an exhaustive analysis of all cloud infrastructure services and security policies"`
2. Click **Send** (or press `Enter`).
3. As soon as the first few words appear streaming in, **immediately click the red Stop button** (square icon) in the input bar.
4. **Observe the result:**
   - Streaming halts instantly.
   - The input button reverts from the red Stop icon to the Send airplane icon.
   - The partial response generated up to the moment of clicking "Stop" remains preserved in the chat bubble.
   - No crash, error toast, or orphaned state occurs.
   - You can immediately type and send another message.

✅ **Acceptance Check:** Mid-stream disconnect cancels generation gracefully and leaves the chat in a usable state.

---

### Scenario 7: Conversation History Persistence Across Refreshes
**Objective:** Verify that guest sessions and conversation histories persist across widget closures and page reloads.

1. With existing messages visible in the chat widget:
   - Note down the conversation text.
2. Click the **✕** button in the top-right of the widget header (or click the floating trigger) to close the widget.
3. Click the floating trigger again to reopen it:
   - All previous messages, timestamps, and feedback states remain visible.
4. Now **refresh the entire browser page** (`F5` or `Ctrl+R`).
5. Click the floating trigger button to open the widget:
   - The widget queries `GET /api/v1/conversations/<id>/messages`.
   - Your prior user messages, assistant responses, citations, and ratings re-populate immediately.

✅ **Acceptance Check:** Conversations persist in localStorage guest session tokens and database records without loss of message history upon refresh.

---

### Scenario 8: Tenant Isolation & Security Boundary Probing
**Objective:** Verify that the API strictly isolates workspaces and prevents unauthorized access to private assistants or foreign conversations.

Open your browser's Developer Console (`F12` ➔ `Console`) or PowerShell and run the following automated security checks:

#### Test 8.1: Verify Public Config Endpoint Never Leaks System Prompts
Run in console or terminal:
```powershell
curl.exe -s http://localhost:4001/api/v1/assistants/4f9d1462-8321-4f11-8be8-2d83ba32d1e0/config
```
**Expected Response:** JSON with `name`, `theme`, `greetingMessage`, `suggestedPrompts`, `capabilities`.  
**Critical Security Check:** Ensure `"systemPrompt"` and `"credentials"` are **NOT present** in the output.

#### Test 8.2: Unauthorized Access to Private Assistant Returns 404
In Day 5 automated tests, private assistants require workspace authorization. Try creating a conversation on a random nonexistent or private assistant without credentials:
```powershell
curl.exe -s -X POST http://localhost:4001/api/v1/conversations `
  -H "Content-Type: application/json" `
  -d '{\"assistantId\": \"5b5d7fa3-7a64-4d25-8516-7012e1750237\"}'
```
**Expected Response:**
```json
{"error":"NotFound","message":"Assistant not found.","statusCode":404}
```
*(Notice: Returns 404 rather than 403 to prevent assistant enumeration attacks!)*

#### Test 8.3: Cross-Conversation Token Tampering Returns 404
Attempt to read messages from an existing conversation using an invalid or foreign `X-Anonymous-Session-Token`:
```powershell
curl.exe -s http://localhost:4001/api/v1/conversations/4f9d1462-8321-4f11-8be8-2d83ba32d1e0/messages `
  -H "X-Anonymous-Session-Token: attacker-forged-token"
```
**Expected Response:** `{"error":"NotFound","message":"Conversation not found.","statusCode":404}`

✅ **Acceptance Check:** Server-side authorization blocks all cross-tenant access and never leaks private assistant existence or system prompts.

---

## 4. Acceptance Checklist & Scorecard

Print or mark this table during manual visual verification:

| # | Test Area | Verification Criteria | Status |
|---|---|---|:---:|
| 1 | **Environment Probes** | `GET /health` & `GET /ready` return 200 OK with `database: connected` | 🔲 Pass |
| 2 | **Host Switching** | Switching between Sentinel, Docs, and Cloud tabs instantly swaps styles | 🔲 Pass |
| 3 | **Theming & Accents** | Sentinel is Cyan/Dark, Docs is Blue/Light, Cloud is Emerald/Dark | 🔲 Pass |
| 4 | **Positioning** | Cloud Operations widget anchors to bottom-left; others to bottom-right | 🔲 Pass |
| 5 | **Mobile Layout (390px)** | Zero horizontal overflow; header stacks; docs sidebar stacks neatly | 🔲 Pass |
| 6 | **Widget on Mobile** | Chat modal fits `calc(100vw - 32px)` with comfortable thumb reach | 🔲 Pass |
| 7 | **Greeting & Prompts** | Assistant greeting message and 3 clickable prompt pills render on load | 🔲 Pass |
| 8 | **SSE Streaming** | Text streams progressively chunk-by-chunk with sub-100ms latency | 🔲 Pass |
| 9 | **Tool Execution Pill** | `Knowledge retrieval completed` pill appears during message generation | 🔲 Pass |
| 10 | **Citations Drawer** | Citation pill renders; clicking opens source title, excerpt, and score | 🔲 Pass |
| 11 | **User Feedback** | Clicking 👍/👎 triggers visual highlight and persists rating to DB | 🔲 Pass |
| 12 | **Stop Generation** | Clicking red square Stop button halts stream and keeps partial text | 🔲 Pass |
| 13 | **History Persistence** | Refreshing browser reloads prior messages, citations, and ratings | 🔲 Pass |
| 14 | **Security: System Prompt** | Public `/config` endpoint strictly redacts `system_prompt` | 🔲 Pass |
| 15 | **Security: Tenant Isolation** | Cross-workspace and unauthenticated private queries return 404 | 🔲 Pass |

---

## 5. Troubleshooting & FAQ

### Issue A: Chat Widget displays "Failed to connect to Nexus AI Assistant"
- **Cause:** The backend API server is not running on `http://localhost:4001` or demo assistants have not been seeded.
- **Fix:** 
  1. Confirm `npm.cmd run dev:api` is running in Terminal 1.
  2. Run `npm.cmd run db:seed` in project root.
  3. Reload `http://localhost:5173`.

### Issue B: Database connection fails on port 5434
- **Cause:** PostgreSQL Docker container is stopped.
- **Fix:** Run `npm.cmd run db:up` to start the PostgreSQL container. Check status with `docker ps`.

### Issue C: Thumbs-up/down button does not highlight
- **Cause:** Message has not finished streaming or database migration `003_create_message_feedback.sql` has not run.
- **Fix:** Wait for the streaming completion event. Run `npm.cmd run db:migrate`.

