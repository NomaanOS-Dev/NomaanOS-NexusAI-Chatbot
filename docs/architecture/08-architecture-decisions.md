# Deliverable H: Architectural Decision Records (ADRs)

This document records the foundational architectural decisions for NomaanOS Nexus AI. Every decision details the context, evaluated alternatives, chosen strategy, trade-offs, security/operational implications, and revisit criteria.

---

## Index of Decisions

1. [ADR-001: Repository Structure and Monorepo Strategy](#adr-001-repository-structure-and-monorepo-strategy)
2. [ADR-002: Modular Monolith Architecture for Nexus AI API](#adr-002-modular-monolith-architecture-for-nexus-ai-api)
3. [ADR-003: Separation of Core API and Python Ingestion Worker Processes](#adr-003-separation-of-core-api-and-python-ingestion-worker-processes)
4. [ADR-004: Dedicated PostgreSQL Instance with pgvector](#adr-004-dedicated-postgresql-instance-with-pgvector)
5. [ADR-005: Hybrid Retrieval Strategy (PostgreSQL FTS + pgvector Cosine Similarity)](#adr-005-hybrid-retrieval-strategy-postgresql-fts--pgvector-cosine-similarity)
6. [ADR-006: Dual Distribution for the Universal Chat Widget](#adr-006-dual-distribution-for-the-universal-chat-widget)
7. [ADR-007: Alignment and Reuse of NomaanOS Authentication & Session Models](#adr-007-alignment-and-reuse-of-nomaanos-authentication--session-models)
8. [ADR-008: Multi-Tenant Hierarchy and Query Isolation Boundaries](#adr-008-multi-tenant-hierarchy-and-query-isolation-boundaries)
9. [ADR-009: Durable Queue Architecture via PostgreSQL SKIP LOCKED](#adr-009-durable-queue-architecture-via-postgresql-skip-locked)
10. [ADR-010: Provider-Independent Inference Gateway Abstraction](#adr-010-provider-independent-inference-gateway-abstraction)
11. [ADR-011: Four-Tier Inference Routing Policies](#adr-011-four-tier-inference-routing-policies)
12. [ADR-012: Air-Gapped Offline Deployment Specification](#adr-012-air-gapped-offline-deployment-specification)
13. [ADR-013: Server-Sent Events (SSE) for Real-Time Chat Streaming](#adr-013-server-sent-events-sse-for-real-time-chat-streaming)
14. [ADR-014: Typed Tool Registry and Mandatory Human-in-the-Loop Approval](#adr-014-typed-tool-registry-and-mandatory-human-in-the-loop-approval)
15. [ADR-015: Loosely Coupled Adapter Boundary for NomaanOS Sentinel Integration](#adr-015-loosely-coupled-adapter-boundary-for-nomaanos-sentinel-integration)
16. [ADR-016: Zero-Credential Browser Exposure & Automated Secret Redaction](#adr-016-zero-credential-browser-exposure--automated-secret-redaction)
17. [ADR-017: Correlation IDs & Structured Pino Observability](#adr-017-correlation-ids--structured-pino-observability)
18. [ADR-018: Multi-Stage Testing & Golden Dataset RAG Evaluation](#adr-018-multi-stage-testing--golden-dataset-rag-evaluation)

---

### ADR-001: Repository Structure and Monorepo Strategy
- **Decision**: House the Nexus AI platform in a dedicated repository (`8-NomaanOS-Nexus-AI`) organized as an npm workspace monorepo (`apps/admin`, `packages/widget`, `packages/shared-types`, `services/api`, `services/ingestion-worker`, `database/migrations`).
- **Context**: Nexus AI must serve multiple NomaanOS applications (Sentinel, Dashboard, future tools) without being tightly bound to the deployment lifecycle or database schema of any single application.
- **Alternatives Considered**:
  1. *Sub-app inside Sentinel repository*: Rejected due to tight deployment coupling, schema entanglement, and inability to independently update for other products.
  2. *Polyrepo (separate repo for widget, API, worker, docs)*: Rejected due to small team overhead, coordinated versioning friction, and complex local development.
- **Advantages**: Single pull request for end-to-end features, clean internal workspace dependency links, independent release tags and CI pipelines.
- **Disadvantages**: Monorepo tooling requires careful linting and build configuration.
- **Security & Ops**: Allows separate containerization of API, worker, and admin dashboard while keeping shared schemas in sync.
- **Revisit Conditions**: Revisit if Nexus AI becomes a fully separate commercial SaaS requiring separate corporate repository access controls.

---

### ADR-002: Modular Monolith Architecture for Nexus AI API
- **Decision**: Build the Nexus AI API as a modular monolith in Node.js/Express/TypeScript, with strict internal module boundaries rather than distributed microservices.
- **Context**: The platform has complex multi-tenant RAG, conversational state, and tool orchestration requirements. A small engineering team cannot justify the operational burden of Kubernetes, service meshes, or distributed tracing for early milestones.
- **Alternatives Considered**: Distributed microservices (separate auth service, conversation service, retrieval service, tool service).
- **Advantages**: Fast in-memory communication, zero network serialization latency, unified transactions, simple single-container deployment, easy local development.
- **Disadvantages**: Potential code entanglement if developers ignore module boundaries. Mitigated via strict TypeScript directory structures and ESLint boundaries.
- **Security & Ops**: Single attack surface to secure, harden, and monitor; simplifies unified session validation.
- **Revisit Conditions**: Revisit when individual modules (e.g. vector retrieval) demand distinct auto-scaling rules or independent multi-region replication.

---

### ADR-003: Separation of Core API and Python Ingestion Worker Processes
- **Decision**: Run document ingestion, parsing, chunking, and embedding generation in a separate background Python worker process, decoupled from the Node.js API server.
- **Context**: Document parsing (PDFs, DOCX, OCR) and embedding generation are CPU- and memory-intensive operations. Running them in the Node.js event loop would cause event loop starvation, degrading API responsiveness and breaking real-time SSE chat streaming. Furthermore, Python has the richest ecosystem of layout-aware document parsers.
- **Alternatives Considered**:
  1. *In-process Node.js parsing*: Node lacks robust, battle-tested PDF layout and document parsing libraries compared to Python (`pypdf`, `pdfplumber`, `unstructured`).
  2. *Child process spawned by Node per upload*: Spawning child processes under high concurrency leads to fork-bomb denial-of-service and unmanaged memory spikes.
- **Advantages**: Complete isolation of heavy CPU/memory loads; API event loop remains ultra-responsive; independent worker process scaling and container resource limits.
- **Disadvantages**: Requires two runtime environments (Node 20+ and Python 3.12).
- **Security & Ops**: Ingestion worker can be placed in a sandbox container with restricted network egress and limited filesystem permissions.
- **Revisit Conditions**: Revisit if native Rust/Wasm parsers in Node reach feature parity with Python document toolchains.

---

### ADR-004: Dedicated PostgreSQL Instance with pgvector
- **Decision**: Deploy a dedicated PostgreSQL 16 database with the `pgvector` extension specifically for Nexus AI (`nomaanos_nexus_ai`), rather than sharing Sentinel's database instance.
- **Context**: Sentinel's existing Docker container uses `postgres:16-alpine`, which does not include `pgvector`. Altering Sentinel's image or sharing its database risks breaking Sentinel's migrations, creating connection contention, and violating tenant blast-radius boundaries.
- **Alternatives Considered**: External specialized vector database (Pinecone, Qdrant, Milvus, Chroma).
- **Advantages**: PostgreSQL with `pgvector` provides transactional consistency across relational metadata, full-text search, and vector embeddings in a single ACID datastore; avoids introducing another distributed database infrastructure.
- **Disadvantages**: Requires indexing maintenance (`HNSW` tuning); vector scale limit ~millions of chunks (more than sufficient for foreseeable NomaanOS workloads).
- **Security & Ops**: Dedicated database limits blast radius; independent backup/restore schedule; strict localhost binding (`127.0.0.1:${PORT}:5432`).
- **Revisit Conditions**: Revisit if vector corpus exceeds 50 million chunks requiring distributed sharding.

---

### ADR-005: Hybrid Retrieval Strategy (PostgreSQL FTS + pgvector Cosine Similarity)
- **Decision**: Implement hybrid retrieval combining PostgreSQL full-text search (`tsvector` + GIN index) and vector semantic search (`pgvector` HNSW cosine distance) merged via Reciprocal Rank Fusion (RRF).
- **Context**: Vector search excels at conceptual and semantic matching but frequently fails on exact keywords, product numbers, IP addresses, log markers, and error codes. Full-text search excels at exact strings but fails on paraphrasing. Combining both yields superior RAG accuracy.
- **Alternatives Considered**: Vector-only search; external Elasticsearch/OpenSearch cluster.
- **Advantages**: Zero additional infrastructure dependencies; native SQL execution; robust retrieval for both technical exact matches and high-level conceptual questions.
- **Disadvantages**: Requires tuning RRF weights ($k = 60$ baseline); slightly higher SQL execution latency compared to single index query (< 30ms combined).
- **Security & Ops**: All search conditions enforce `workspace_id = $1` at the SQL query level before ranking.
- **Revisit Conditions**: Revisit if multi-lingual cross-lingual semantic matching demands specialized external sparse-dense models.

---

### ADR-006: Dual Distribution for the Universal Chat Widget
- **Decision**: Package the Universal Chat Widget both as an embeddable standalone JavaScript bundle (IIFE/UMD via CDN/script tag) and as a standard npm package (`@nomaanos/nexus-widget`).
- **Context**: NomaanOS applications use different frontend architectures. For example, Sentinel Web and NomaanOS Dashboard are Next.js/React applications that benefit from typed React component imports, while external client portals and static documentation sites require a drop-in `<script>` tag.
- **Alternatives Considered**: NPM package only; `<iframe>` embed only.
- **Advantages**: Universal compatibility across Next.js, static HTML, Vue, or any web framework; shared theme and branding parameters.
- **Disadvantages**: Requires maintaining two build outputs in Vite.
- **Security & Ops**: Widget executes within the host page context or Shadow DOM, requiring strict CSP rules and sanitization against XSS. Zero API credentials bundled.
- **Revisit Conditions**: Revisit if iframe isolation becomes legally required by third-party hosting partners.

---

### ADR-007: Alignment and Reuse of NomaanOS Authentication & Session Models
- **Decision**: Adopt the proven SHA-256 session token hashing and cookie-based authentication architecture from NomaanOS Sentinel.
- **Context**: Sentinel's authentication system is thoroughly tested, secure, and satisfies enterprise security requirements (`HttpOnly`, `SameSite=Lax`, anti-enumeration, sliding expiration). Users should experience single sign-on or familiar authentication semantics across NomaanOS applications.
- **Alternatives Considered**: Stateless JWTs; external identity provider (Auth0/Clerk).
- **Advantages**: Immediate session revocation capability (unlike stateless JWTs); zero external IdP costs; tested implementation patterns ready to adopt.
- **Disadvantages**: Database lookup on authenticated requests (mitigated by high-performance index on `session_token_hash`).
- **Security & Ops**: Cryptographic protection against database leakage; tokens hashed with SHA-256 before storage.
- **Revisit Conditions**: Revisit when enterprise OIDC/SAML SSO federation is required for Fortune 500 customers.

---

### ADR-008: Multi-Tenant Hierarchy and Query Isolation Boundaries
- **Decision**: Enforce a strict two-tier tenant hierarchy: `Organization` -> `Workspace` -> `Resources` (Assistants, Knowledge Spaces, Documents, Conversations, Audit Events). Every query MUST include `WHERE workspace_id = $1`.
- **Context**: Nexus AI serves Managed Service Providers (MSPs) and multi-client environments. Data cross-contamination between workspaces is catastrophic.
- **Alternatives Considered**: Single-tier tenancy (workspaces only); separate database per tenant.
- **Advantages**: Clean separation between billing/administrative org boundaries and operational workspace data; avoids managing thousands of physical database schemas.
- **Disadvantages**: Requires disciplined code review and automated integration tests verifying tenant isolation clauses.
- **Security & Ops**: Non-negotiable defense: every repository function requires an explicit `workspaceId` parameter validated against the caller's session.
- **Revisit Conditions**: Revisit if an enterprise client legally mandates a physically dedicated database cluster.

---

### ADR-009: Durable Queue Architecture via PostgreSQL SKIP LOCKED
- **Decision**: Implement the asynchronous ingestion job queue using PostgreSQL tables with `FOR UPDATE SKIP LOCKED` and lease expiration, mirroring Sentinel's `JobQueue`.
- **Context**: The platform needs durable, persistent background job scheduling with at-least-once processing, retry counters, and crash recovery. Introducing Redis, BullMQ, or RabbitMQ adds unnecessary infrastructure complexity and operational points of failure for an early-stage product.
- **Alternatives Considered**: Redis BullMQ; RabbitMQ; AWS SQS.
- **Advantages**: Zero additional services to run, configure, backup, or monitor; transactional enqueuing alongside source records; automatic crash recovery via lease timestamps.
- **Disadvantages**: High ingestion concurrency (> 5,000 jobs/minute) can cause PostgreSQL transaction table bloat (not a bottleneck for planned document ingestion volumes).
- **Security & Ops**: Full database audit trail of all job states and failure stack traces.
- **Revisit Conditions**: Revisit if ingestion volume exceeds 10,000 document uploads per hour.

---

### ADR-010: Provider-Independent Inference Gateway Abstraction
- **Decision**: Implement an internal `AiProviderAdapter` interface in the API that abstracts away specific LLM provider SDKs, utilizing native HTTP `fetch` and `AbortController`.
- **Context**: The platform must support local inference runtimes (Ollama), cloud inference providers (Gemini, OpenAI, Anthropic), and mock testing providers without polluting core application logic with vendor-specific SDK dependencies.
- **Alternatives Considered**: LangChain / LlamaIndex frameworks; vendor-specific SDKs (`@google/genai`, `openai`).
- **Advantages**: Ultra-lightweight footprint; zero heavyweight framework bloat; uniform error code mapping (`PROVIDER_TIMEOUT`, `RATE_LIMIT_EXCEEDED`, `MALFORMED_RESPONSE`); complete control over timeouts and request cancellation.
- **Disadvantages**: Requires maintaining simple provider-specific request/response serialization adapters (~100 lines each).
- **Security & Ops**: Provider credentials remain strictly server-side; cancellation immediately aborts upstream HTTP requests to conserve token costs.
- **Revisit Conditions**: Revisit if unified standards like Model Context Protocol (MCP) become ubiquitous across all desired providers.

---

### ADR-011: Four-Tier Inference Routing Policies
- **Decision**: Provide four explicit, assistant-configurable inference policies: `local-only`, `cloud-preferred`, `hybrid`, and `cloud-only`.
- **Context**: Different tenants have vastly different security, cost, and latency tolerances. A defense contractor may require 100% on-premises local inference, while a marketing team may demand highest-tier cloud synthesis.
- **Alternatives Considered**: Single global inference provider; opaque dynamic routing without user visibility.
- **Advantages**: Explicit tenant control; guarantees data sovereignty; enables automatic fallback during cloud provider outages in `cloud-preferred` mode.
- **Disadvantages**: Requires maintaining local model capability parity for prompts.
- **Security & Ops**: `local-only` policy is backed by a hard code barrier throwing an error if any cloud API call is attempted.
- **Revisit Conditions**: Revisit when fine-tuned custom open-source models match frontier cloud reasoning across all tasks.

---

### ADR-012: Air-Gapped Offline Deployment Specification
- **Decision**: Formally architect and verify a 100% offline deployment mode where the entire stack (Widget, API, Ingestion Worker, PostgreSQL + pgvector, Ollama + local weights) operates with zero internet access.
- **Context**: "Local model" does not equal "offline-capable". Applications frequently fail offline due to CDN-hosted web fonts, cloud embedding APIs, external tokenizers, or telemetry pings.
- **Alternatives Considered**: Assuming local Ollama is sufficient without verifying dependencies.
- **Advantages**: Guarantees true air-gapped readiness for defense, healthcare, and high-security enterprise environments.
- **Disadvantages**: Requires bundling all web assets, fonts, model weights, and tokenizer files inside local Docker images.
- **Security & Ops**: Tested by isolating Docker Compose network with `internal: true` and validating full RAG query completion.
- **Revisit Conditions**: Permanent invariant of the Nexus AI architecture.

---

### ADR-013: Server-Sent Events (SSE) for Real-Time Chat Streaming
- **Decision**: Use HTTP Server-Sent Events (SSE) over HTTP/2 or standard HTTP/1.1 for real-time chat streaming, rather than WebSockets.
- **Context**: The chat widget needs real-time token streaming, citation delivery, tool status updates, and error alerts. Client-to-server traffic is primarily discrete request-response turns, while server-to-client traffic is a unidirectional stream.
- **Alternatives Considered**: WebSockets; long-polling.
- **Advantages**: Simple native browser support via `EventSource` or `fetch` with streaming reader; works seamlessly over standard corporate HTTP firewalls and reverse proxies without connection upgrade issues; built-in reconnection semantics.
- **Disadvantages**: Unidirectional (client sends new messages via separate POST requests).
- **Security & Ops**: Preserves standard HTTP authorization headers and cookie mechanics; simplified load-balancer sticky session requirements.
- **Revisit Conditions**: Revisit if full-duplex low-latency audio/video streaming is introduced to the widget.

---

### ADR-014: Typed Tool Registry and Mandatory Human-in-the-Loop Approval
- **Decision**: Require all assistant tools to declare explicit JSON Schemas, required RBAC roles, and an approval classification. Consequential tools MUST pause execution and require explicit human sign-off via an `ApprovalRequest` record.
- **Context**: Autonomous LLM agents are prone to prompt injection and hallucinated actions. Giving an LLM unrestrained permission to modify firewall rules, delete users, or execute commands without human oversight is a critical security vulnerability.
- **Alternatives Considered**: Unbounded autonomous agent execution; soft warnings in chat.
- **Advantages**: Hard deterministic security gate; cryptographically auditable approval trail; protects host infrastructure from prompt injection exploits.
- **Disadvantages**: Introduces latency into workflows requiring user confirmation.
- **Security & Ops**: The LLM is never the authority that approves an action. Authorization is verified in trusted server code against the approving human user's session.
- **Revisit Conditions**: Permanent security invariant for all mutating or consequential actions.

---

### ADR-015: Loosely Coupled Adapter Boundary for NomaanOS Sentinel Integration
- **Decision**: Integrate Nexus AI with NomaanOS Sentinel strictly through Sentinel's public/internal authenticated REST API contracts, rather than directly accessing Sentinel's database tables.
- **Context**: Sentinel is an active, production codebase with its own release cycle and migration lineage. Directly querying or writing to Sentinel's `security_events` or `cases` tables would create tight schema coupling, bypass Sentinel's business validation, and risk breaking Sentinel.
- **Alternatives Considered**: Direct PostgreSQL foreign-data-wrapper (FDW) or cross-database queries.
- **Advantages**: Sentinel retains absolute ownership of its data models; Sentinel API upgrades do not silently break Nexus AI; security boundaries remain cleanly enforced.
- **Disadvantages**: Requires minor HTTP network hop between services.
- **Security & Ops**: Nexus AI accesses Sentinel using workspace-scoped API tokens or forwarded user sessions, inheriting Sentinel's existing RBAC.
- **Revisit Conditions**: Revisit if event streaming throughput requires high-speed shared memory IPC.

---

### ADR-016: Zero-Credential Browser Exposure & Automated Secret Redaction
- **Decision**: Maintain a strict zero-credential front-end policy and enforce automated server-side secret redaction in all logging and evidence preparation pipelines.
- **Context**: API keys and tokens in browser client code are immediately extracted by adversaries. Furthermore, sensitive log telemetry frequently contains passwords and private keys that must not be sent to AI models or persisted in debug logs.
- **Alternatives Considered**: Relying on developers to manually redact secrets in log calls.
- **Advantages**: Systematic elimination of accidental credential leakage; protects enterprise compliance standing.
- **Disadvantages**: Negligible CPU regex overhead during log serialization (< 1ms).
- **Security & Ops**: Redaction patterns strip passwords, bearer tokens, API keys, and session cookies automatically.
- **Revisit Conditions**: Permanent architectural requirement.

---

### ADR-017: Correlation IDs & Structured Pino Observability
- **Decision**: Mandate structured JSON logging using `pino` and `pino-http`, with cryptographic correlation IDs (`x-correlation-id`) attached to every request and propagated across asynchronous job queues and worker processes.
- **Context**: Debugging distributed multi-step RAG workflows (Widget -> API -> Retrieval -> Embedding -> LLM -> DB) without correlation IDs is slow and error-prone.
- **Alternatives Considered**: Plain `console.log`; heavy APM agents (Datadog/NewRelic) requiring proprietary licenses.
- **Advantages**: Ultra-high performance logging; machine-readable JSON for easy ingestion into any log aggregator; complete request traceability.
- **Disadvantages**: Developers must pass context or logger instances to deep utility functions.
- **Security & Ops**: High-entropy correlation IDs allow rapid forensic incident response without logging PII.
- **Revisit Conditions**: Revisit when enterprise distributed tracing (OpenTelemetry) is required.

---

### ADR-018: Multi-Stage Testing & Golden Dataset RAG Evaluation
- **Decision**: Implement a multi-stage testing pyramid comprising fast Vitest unit tests, real PostgreSQL integration tests, deterministic mock inference tests, and a dedicated RAG evaluation benchmark harness against golden datasets.
- **Context**: AI applications suffer from non-deterministic regressions, hallucination creep, and silent retrieval degradation that traditional unit tests cannot detect.
- **Alternatives Considered**: Only writing unit tests with 100% mocked databases.
- **Advantages**: Real database tests verify complex SQL queries and pgvector indexes; golden dataset benchmarks quantitatively evaluate retrieval precision, recall, and answer faithfulness before releases.
- **Disadvantages**: Maintaining golden benchmark datasets requires ongoing domain curation.
- **Security & Ops**: Negative security regression tests run in automated CI to prevent cross-tenant regressions.
- **Revisit Conditions**: Revisit when automated synthetic benchmark generators achieve sufficient evaluation reliability.

