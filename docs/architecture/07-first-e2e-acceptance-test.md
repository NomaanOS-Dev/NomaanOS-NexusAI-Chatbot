# Deliverable G: First End-to-End Acceptance Test Specification

## 1. Overview & Acceptance Objective

The objective of the First End-to-End Acceptance Test is to validate the smallest complete, coherent path through the Nexus AI platform architecture. This test exercises the full lifecycle across the **Widget**, **API Gateway**, **Authentication / Tenant Scoping**, **Hybrid Retrieval (FTS + pgvector)**, **Inference Engine (Mock / Local)**, **Citation Delivery**, and **Persistence**.

---

## 2. Target 15-Step Acceptance Flow

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Tenant A User)
    participant Host as NomaanOS Dashboard
    participant Widget as Nexus AI Widget
    participant API as Nexus AI Core API
    participant DB as PostgreSQL (pgvector + FTS)
    participant Inf as Inference Engine (Mock/Ollama)
    actor Bob as Bob (Tenant B User)

    Note over Alice,Host: Step 1-3: Initialization
    Alice->>Host: 1. Opens authorized dashboard
    Host->>Widget: 2. Loads chat widget bundle
    Widget->>API: 3. GET /api/v1/assistants/:id/config
    API-->>Widget: Returns public branding & capabilities

    Note over Alice,Inf: Step 4-7: Message Ingestion
    Alice->>Widget: 4. Sends message: "What port does the SSH service use?"
    Widget->>API: 5-6. POST /api/v1/conversations/:id/messages (with session cookie)
    API->>API: Verifies identity, workspace membership & assistant scoping
    API->>DB: 7. Inserts user message record

    Note over API,Inf: Step 8-11: Grounded Retrieval & Streaming
    API->>DB: 8. Hybrid search strictly scoped to Tenant A's Knowledge Space
    DB-->>API: Returns chunk #1 ("SSH runs on port 2222 per SOC policy")
    API->>Inf: 9. Calls inference with <evidence> chunk #1
    API-->>Widget: 10. Opens SSE stream (event: message_start)
    API-->>Widget: 11. Emits citations event citing chunk #1
    loop Token Streaming
        Inf-->>API: Stream token chunks
        API-->>Widget: Emits content_delta: "Per SOC policy, port 2222..."
    end

    Note over Alice,DB: Step 12-14: Persistence & Reopening
    Inf-->>API: Stream complete
    API->>DB: 13. Persists assistant message & citation link
    API-->>Widget: Emits message_complete
    Alice->>Widget: 14. Reopens conversation; history loaded accurately

    Note over Bob,API: Step 15: Cross-Tenant Isolation Negative Test
    Bob->>API: 15. Attempts GET /api/v1/conversations/Alice-conv-id
    API-->>Bob: Returns 404 Not Found (Cross-tenant access blocked)
```

### Detailed Step-by-Step Verification:
1. **User opens authorized application**: Alice signs into NomaanOS Dashboard (`7-NomaanOS-Dashboard`) belonging to Workspace `ws-tenant-alpha`.
2. **Loads reusable chat widget**: The host page embeds `<nexus-chat assistant-id="asst-alpha" />`. The widget initializes without throwing errors.
3. **Widget obtains assistant config**: Widget calls `GET /api/v1/assistants/asst-alpha/config`. Asserts response contains `primaryColor`, `greetingMessage`, and zero system prompts or secrets.
4. **User sends message**: Alice inputs *"What port does the SSH service use on server web-01?"*.
5. **API verifies identity**: API middleware reads session cookie, validates SHA-256 session hash against PostgreSQL `sessions`, and populates `req.user` and `req.workspace`.
6. **API validates access**: Asserts `asst-alpha` belongs to `ws-tenant-alpha` and user has `viewer+` role.
7. **API stores user message**: Inserts message row into `messages` table with role `'user'`.
8. **Retrieval searches only authorized knowledge**: Hybrid retrieval queries PostgreSQL `document_chunks` with mandatory filter `WHERE workspace_id = 'ws-tenant-alpha'`. Chunks from Workspace Beta are excluded at the database engine level.
9. **Inference generates grounded answer**: System instructions feed retrieved chunk into model. For Milestone 1/2 tests, a deterministic `MockAiProvider` returns a pre-calibrated answer citing the synthetic chunk ID.
10. **API streams response via SSE**: Content is streamed token-by-token over Server-Sent Events with header `Content-Type: text/event-stream`.
11. **Response includes citations**: Stream emits `event: citations` carrying `sourceTitle: "Infrastructure Spec v1"`, `chunkId`, and text excerpt.
12. **Insufficient evidence behavior**: In a parallel test case where query is *"What is the secret Wi-Fi password?"* (not in knowledge space), model responds *"I do not have sufficient information in the authorized documents to answer this question."* with zero hallucinated facts.
13. **Persist assistant message**: Full message content, token count, duration, and cited chunk foreign keys are committed to PostgreSQL.
14. **Reopen conversation**: Widget calls `GET /api/v1/conversations/:id/messages`; verifies both user message and assistant response with citations are returned identically.
15. **Cross-tenant isolation negative test**: Bob, authenticated as Workspace `ws-tenant-beta`, attempts to fetch Alice's conversation (`GET /api/v1/conversations/:alice-id`). The API returns `404 Not Found`. Bob performs a search; results contain 0 hits from Tenant Alpha's documents.

---

## 3. Staged Acceptance Testing Plan

| Stage | Test Scope | Focus Area | Success Metric (Pass/Fail) |
|---|---|---|---|
| **Stage 1** | Architecture & Health Validation | `/health`, `/ready`, DB connectivity | 200 OK within 50ms; pgvector extension confirmed loaded. |
| **Stage 2** | API Contract Validation | Assistant config, conversation lifecycle | 100% adherence to OpenAPI schema; 0 secrets in responses. |
| **Stage 3** | Authentication & RBAC | Session cookies, workspace boundaries | Unauthorized requests return 401; mismatched tenants return 404. |
| **Stage 4** | Document Ingestion Queue | Upload -> Chunk -> Embed -> Ready | 100% of chunks have valid tenant foreign keys; 0 orphaned rows. |
| **Stage 5** | Hybrid Retrieval & Grounding | Vector similarity + FTS ranking | Reciprocal Rank Fusion returns top chunk with score > 0.8; 0 cross-tenant chunks. |
| **Stage 6** | SSE Streaming & Citations | Real-time token streaming | First token latency < 500ms (mock) / < 2s (local); citations emitted. |
| **Stage 7** | Abstention on Missing Evidence | Knowledge gap handling | Assistant explicitly communicates uncertainty; 0 fabricated claims. |
| **Stage 8** | Cross-Tenant Security Invariant | Negative authorization tests | Zero leaks across 100 synthetic cross-workspace queries. |
| **Stage 9** | Offline Inference Validation | Network air-gap simulation | Full conversation completes with zero outbound internet traffic. |

---

## 4. Milestone 1 Mock Inference Adapter Specification

To enable repeatable, deterministic CI testing on Day 2 before live local Ollama or cloud models are connected, a dedicated `MockAiProvider` is specified:

```typescript
export class MockAiProvider implements AiProviderAdapter {
  public readonly providerName = 'mock';

  async generateStream(req: AiProviderRequest): Promise<AsyncIterable<string>> {
    // Check if query is about the synthetic test fixture
    if (req.prompt.includes('SSH service')) {
      const tokens = ['According ', 'to ', 'the ', 'authorized ', 'spec, ', 'SSH ', 'runs ', 'on ', 'port ', '2222.'];
      return (async function* () {
        for (const token of tokens) {
          yield token;
        }
      })();
    }

    // Default insufficient evidence response
    const tokens = ['I ', 'do ', 'not ', 'have ', 'sufficient ', 'information ', 'in ', 'the ', 'provided ', 'evidence.'];
    return (async function* () {
      for (const token of tokens) {
        yield token;
      }
    })();
  }
}
```

> [!NOTE]
> The mock provider is strictly a testing harness tool. Live local inference (Ollama with Llama 3 / Mistral) and cloud adapters (Gemini / OpenAI) will be connected and validated against the exact same test suite in Day 3.

