# Deliverable C: Versioned API Contract Draft

## 1. Overview & Protocol Conventions

All Nexus AI endpoints are versioned under `/api/v1/` unless designated as root infrastructure probes (`/health`, `/ready`).
- **Data Format**: Standard JSON (`application/json; charset=utf-8`).
- **Streaming Format**: Server-Sent Events (`text/event-stream; charset=utf-8`).
- **Character Encoding**: UTF-8.
- **Identifiers**: Standard UUID v4 strings matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
- **Timestamps**: ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- **Standard Error Envelope**:
  ```json
  {
    "error": "ErrorTypeConstant",
    "message": "Human-readable explanation of error.",
    "statusCode": 400,
    "details": {}
  }
  ```

---

## 2. Infrastructure Endpoints

### 2.1 Liveness Probe
- **Route**: `GET /health`
- **Purpose**: Fast process liveness verification for container orchestrators.
- **Auth**: None (Public).
- **Permissions**: None.
- **Request**: Empty.
- **Response (200 OK)**:
  ```json
  {
    "status": "ok",
    "service": "nexus-ai-api",
    "timestamp": "2026-10-31T12:00:00.000Z"
  }
  ```
- **Error Responses**: `500 Internal Server Error` if node event loop is blocked.
- **Phase**: Milestone 1.

### 2.2 Readiness Probe
- **Route**: `GET /ready`
- **Purpose**: Verifies that PostgreSQL is reachable, pgvector extension is available, and worker queue is responsive.
- **Auth**: None (Public).
- **Permissions**: None.
- **Request**: Empty.
- **Response (200 OK)**:
  ```json
  {
    "status": "ready",
    "checks": {
      "database": "ok",
      "pgvector": "ok",
      "workerQueue": "ok"
    },
    "latencyMs": 4
  }
  ```
- **Error Responses**: `503 Service Unavailable` if database connection fails.
- **Phase**: Milestone 1.

---

## 3. Assistant Configuration

### 3.1 Get Public Assistant Configuration
- **Route**: `GET /api/v1/assistants/:assistantId/config`
- **Purpose**: Returns branding, theme parameters, greeting message, and client-safe capabilities for the chat widget.
- **Auth**: Optional / Anonymous if assistant allows public embedding; Session auth if workspace-private.
- **Permissions**: Public mode: None; Private mode: Workspace `viewer+`.
- **Security Invariant**: **MUST NEVER** return system prompts, API keys, provider endpoints, internal tool configurations, or raw database connection details.
- **Request**: Empty.
- **Response (200 OK)**:
  ```json
  {
    "assistantId": "4f9d1462-8321-4f11-8be8-2d83ba32d1e0",
    "name": "Sentinel Cyber Copilot",
    "description": "Investigate security alerts and telemetry with AI.",
    "avatarUrl": "https://assets.nomaanos.io/avatars/sentinel.png",
    "theme": {
      "primaryColor": "#06b6d4",
      "fontFamily": "Inter, sans-serif",
      "darkMode": true,
      "brandLogoUrl": "https://assets.nomaanos.io/logos/sentinel.svg"
    },
    "greetingMessage": "Hello! I am your Sentinel AI assistant. How can I help you investigate today?",
    "suggestedPrompts": [
      "Summarize recent SSH brute-force alerts",
      "Explain MITRE technique T1110.001",
      "Search authorized security runbooks"
    ],
    "capabilities": {
      "streaming": true,
      "fileUpload": false,
      "feedback": true,
      "citations": true
    }
  }
  ```
- **Error Responses**:
  - `404 Not Found`: Assistant ID does not exist.
  - `403 Forbidden`: Assistant is workspace-private and caller has no membership.
- **Tenant Isolation**: Asserts assistant belongs to the requesting workspace or is marked `public_embed_allowed = TRUE`.
- **Audit Requirement**: Read-only; logged at debug level.
- **Phase**: Milestone 2.

---

## 4. Conversation Management

### 4.1 Create Conversation
- **Route**: `POST /api/v1/conversations`
- **Purpose**: Initializes a new conversation session for an authorized user or anonymous guest.
- **Auth**: Authenticated session or Anonymous Session Token.
- **Permissions**: Workspace `viewer+` or valid anonymous assistant token.
- **Request Schema**:
  ```json
  {
    "assistantId": "4f9d1462-8321-4f11-8be8-2d83ba32d1e0",
    "title": "Optional initial conversation title",
    "metadata": {
      "hostApplication": "nomaanos-sentinel",
      "referrer": "https://sentinel.nomaanos.io/workspaces/ws-1/cases/case-12"
    }
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "conversationId": "91a82f04-8b1e-4509-a1b4-ff70f7d4e320",
    "assistantId": "4f9d1462-8321-4f11-8be8-2d83ba32d1e0",
    "workspaceId": "50355e88-279e-4c9a-9a94-9cedff9d8bb3",
    "title": "New Conversation",
    "createdAt": "2026-10-31T12:05:00.000Z",
    "updatedAt": "2026-10-31T12:05:00.000Z"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid assistantId UUID or malformed metadata.
  - `403 Forbidden`: User lacks permission to use this assistant.
- **Phase**: Milestone 2.

### 4.2 Get Conversation Details
- **Route**: `GET /api/v1/conversations/:conversationId`
- **Purpose**: Retrieves conversation metadata and message counts.
- **Auth**: Authenticated session or matching anonymous session token.
- **Permissions**: Conversation creator or workspace `viewer+`.
- **Tenant Isolation**: Enforces `workspace_id` and creator ownership.
- **Response (200 OK)**:
  ```json
  {
    "conversationId": "91a82f04-8b1e-4509-a1b4-ff70f7d4e320",
    "assistantId": "4f9d1462-8321-4f11-8be8-2d83ba32d1e0",
    "workspaceId": "50355e88-279e-4c9a-9a94-9cedff9d8bb3",
    "title": "SSH Alert Analysis",
    "messageCount": 4,
    "createdAt": "2026-10-31T12:05:00.000Z",
    "updatedAt": "2026-10-31T12:08:30.000Z"
  }
  ```
- **Phase**: Milestone 2.

### 4.3 Get Conversation Messages
- **Route**: `GET /api/v1/conversations/:conversationId/messages`
- **Purpose**: Paginated list of messages and citations for conversation history restoration.
- **Auth**: Authenticated session or matching anonymous token.
- **Permissions**: Creator or workspace `viewer+`.
- **Response (200 OK)**:
  ```json
  {
    "messages": [
      {
        "id": "28f9d3b0-2212-4c28-912b-3141209b11e4",
        "role": "user",
        "content": "What failed logins were observed on host web-01?",
        "createdAt": "2026-10-31T12:05:10.000Z"
      },
      {
        "id": "7fa30419-5832-475a-a621-e018d9b155a0",
        "role": "assistant",
        "content": "According to the security events, host **web-01** recorded 14 failed SSH authentication attempts targeting user `root` between 10:14:00 and 10:18:22 UTC.",
        "citations": [
          {
            "citationIndex": 1,
            "sourceId": "550e8400-e29b-41d4-a716-446655440000",
            "sourceTitle": "Auth Log Dataset Oct-31",
            "chunkId": "61a29f04-1111-4509-a1b4-ff70f7d4e320",
            "excerpt": "Oct 31 10:14:02 web-01 sshd[1244]: Failed password for root from 198.51.100.2 port 44322 ssh2"
          }
        ],
        "createdAt": "2026-10-31T12:05:15.000Z"
      }
    ]
  }
  ```
- **Phase**: Milestone 2.

---

## 5. Chat & Streaming Engine (Server-Sent Events)

### 5.1 Send Message and Stream Response
- **Route**: `POST /api/v1/conversations/:conversationId/messages`
- **Headers**:
  - `Accept: text/event-stream`
  - `Content-Type: application/json`
  - `X-Idempotency-Key: <client-generated-uuid>`
- **Request Schema**:
  ```json
  {
    "content": "What failed logins were observed on host web-01?",
    "knowledgeSpaceIds": ["c1a29f04-8b1e-4509-a1b4-ff70f7d4e320"],
    "stream": true
  }
  ```

#### Server-Sent Events (SSE) Protocol Specification
The response stream utilizes discrete, typed SSE event blocks formatted as `event: <name>\ndata: <json>\n\n`:

1. **Event: `message_start`** (Fired once when generation starts):
   ```
   event: message_start
   data: {"messageId":"7fa30419-5832-475a-a621-e018d9b155a0","conversationId":"91a82f04-8b1e-4509-a1b4-ff70f7d4e320","role":"assistant"}
   ```

2. **Event: `citations`** (Delivered after hybrid retrieval, before tokens):
   ```
   event: citations
   data: [{"citationIndex":1,"sourceId":"550e8400-e29b-41d4-a716-446655440000","sourceTitle":"Auth Log Dataset Oct-31","chunkId":"61a29f04-1111-4509-a1b4-ff70f7d4e320","excerpt":"Failed password for root from 198.51.100.2"}]
   ```

3. **Event: `content_delta`** (Repeated for each token/chunk):
   ```
   event: content_delta
   data: {"delta":"According "}

   event: content_delta
   data: {"delta":"to the logs, "}
   ```

4. **Event: `tool_call_start`** (If the model invokes an authorized tool):
   ```
   event: tool_call_start
   data: {"toolExecutionId":"99f8d3b0-2212-4c28-912b-3141209b11e4","toolName":"sentinel_query_events","arguments":{"sourceHost":"web-01","limit":5}}
   ```

5. **Event: `approval_required`** (If a tool action requires human confirmation):
   ```
   event: approval_required
   data: {"approvalId":"aa01d3b0-2212-4c28-912b-3141209b11e4","toolName":"sentinel_create_case","proposedAction":"Create high-priority investigation case for web-01 brute force","expiresAt":"2026-10-31T12:35:00.000Z"}
   ```

6. **Event: `message_complete`** (Fired upon successful stream finish):
   ```
   event: message_complete
   data: {"messageId":"7fa30419-5832-475a-a621-e018d9b155a0","finishReason":"stop","usage":{"promptTokens":340,"completionTokens":85,"totalTokens":425},"durationMs":1420}
   ```

7. **Event: `error`** (Fired on stream failure):
   ```
   event: error
   data: {"code":"INFERENCE_TIMEOUT","message":"The local inference engine timed out after 30000ms."}
   ```

- **Cancellation Handling**: If the HTTP client connection aborts, the API attaches an `AbortController` to the inference engine and database retrieval promises, aborting downstream computations immediately.
- **Phase**: Milestone 2.

---

## 6. Knowledge Sources & Ingestion Jobs

### 6.1 Register & Upload Knowledge Source
- **Route**: `POST /api/v1/knowledge-spaces/:knowledgeSpaceId/sources`
- **Content-Type**: `multipart/form-data`
- **Permissions**: Workspace `analyst+`.
- **Form Fields**:
  - `file`: Raw binary document (`.pdf`, `.md`, `.txt`, `.docx`, `.html`) (Max 15 MiB).
  - `title`: String (Optional, defaults to filename).
  - `metadata`: JSON string of custom source attributes.
- **Response (202 Accepted)**:
  ```json
  {
    "sourceId": "550e8400-e29b-41d4-a716-446655440000",
    "knowledgeSpaceId": "c1a29f04-8b1e-4509-a1b4-ff70f7d4e320",
    "filename": "incident-response-runbook.pdf",
    "fileSizeBytes": 451200,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "job": {
      "jobId": "88a29f04-8b1e-4509-a1b4-ff70f7d4e320",
      "status": "queued",
      "createdAt": "2026-10-31T12:10:00.000Z"
    }
  }
  ```
- **Phase**: Milestone 3.

### 6.2 Get Ingestion Job Status
- **Route**: `GET /api/v1/ingestion-jobs/:jobId`
- **Purpose**: Polling endpoint for workers and UI dashboards.
- **Permissions**: Workspace `viewer+`.
- **Response (200 OK)**:
  ```json
  {
    "jobId": "88a29f04-8b1e-4509-a1b4-ff70f7d4e320",
    "sourceId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "attempts": 1,
    "totalChunks": 24,
    "durationMs": 3200,
    "errorMessage": null,
    "createdAt": "2026-10-31T12:10:00.000Z",
    "completedAt": "2026-10-31T12:10:03.200Z"
  }
  ```
- **Job States**: `queued` -> `processing` -> `completed` | `failed` | `cancelled`.
- **Phase**: Milestone 3.

### 6.3 Delete Knowledge Source
- **Route**: `DELETE /api/v1/sources/:sourceId`
- **Purpose**: Atomically soft-deletes source record and removes all related chunks, vector embeddings, and search index entries.
- **Permissions**: Workspace `admin+`.
- **Response (200 OK)**:
  ```json
  {
    "status": "ok",
    "sourceId": "550e8400-e29b-41d4-a716-446655440000",
    "deletedChunksCount": 24
  }
  ```
- **Phase**: Milestone 3.

---

## 7. Human-in-the-Loop Approvals & Tool Registry

### 7.1 List Available Tools for Assistant
- **Route**: `GET /api/v1/assistants/:assistantId/tools`
- **Permissions**: Workspace `viewer+`.
- **Response (200 OK)**:
  ```json
  {
    "tools": [
      {
        "name": "sentinel_query_events",
        "description": "Query sanitized security events by host or event type",
        "parameters": {
          "type": "object",
          "properties": {
            "sourceHost": { "type": "string" },
            "limit": { "type": "integer", "maximum": 50 }
          },
          "required": ["sourceHost"]
        },
        "requiresApproval": false
      },
      {
        "name": "sentinel_create_case",
        "description": "Create a new security incident case in Sentinel",
        "parameters": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
          },
          "required": ["title", "priority"]
        },
        "requiresApproval": true
      }
    ]
  }
  ```
- **Phase**: Milestone 5.

### 7.2 Submit Human Approval Decision
- **Route**: `POST /api/v1/approvals/:approvalId/decision`
- **Permissions**: Workspace `analyst+` (or `admin+` based on tool definition).
- **Request Schema**:
  ```json
  {
    "decision": "approved",
    "reason": "Confirmed incident matches brute-force pattern."
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "approvalId": "aa01d3b0-2212-4c28-912b-3141209b11e4",
    "status": "approved",
    "decidedBy": "user-uuid",
    "decidedAt": "2026-10-31T12:15:00.000Z"
  }
  ```
- **Phase**: Milestone 5.

---

## 8. User Feedback

### 8.1 Submit Message Feedback
- **Route**: `POST /api/v1/conversations/:conversationId/messages/:messageId/feedback`
- **Permissions**: Conversation participant.
- **Request Schema**:
  ```json
  {
    "rating": 1,
    "feedbackText": "Very helpful citation directly referenced the correct log line.",
    "category": "accurate_citation"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "status": "ok",
    "feedbackId": "bb01d3b0-2212-4c28-912b-3141209b11e4"
  }
  ```
- **Phase**: Milestone 4.

