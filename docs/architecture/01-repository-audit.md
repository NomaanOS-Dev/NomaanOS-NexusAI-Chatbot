# Deliverable A: Repository and Ecosystem Audit

## 1. Executive Summary

This audit evaluates the existing repositories and codebases within the NomaanOS ecosystem at `D:\Projects`. The inspection was conducted directly against actual filesystem artifacts, codebases, schemas, and configurations to determine the architectural foundations, reusable modules, technology standards, operational boundaries, and risks for **NomaanOS Nexus AI**.

---

## 2. Inspected Repositories & Workspaces

The following workspaces were directly inspected and verified:

| Workspace Path | Ecosystem Role | Technology Stack | Status & Inspection Evidence |
|---|---|---|---|
| `D:\Projects\6-NomaanOS-Sentinel` | Cyber threat detection & incident response platform | Node.js 20+ (Express, ESM), TypeScript 5.8, Next.js 14, React 18, PostgreSQL 16, Python 3.12 | Fully implemented, working, git repo (`origin: https://github.com/NomaanOS-Dev/NomaanOS-Sentinel.git`), 62 Vitest tests, 20 Pytest tests passing. |
| `D:\Projects\7-NomaanOS-Dashboard` | Central web console & cybersecurity dashboard | Next.js 14 (App Router), React 18, TypeScript 5.6, Tailwind CSS 3.4, Lucide React | Implemented UI frontend with header, responsive main viewport container, and global search component (`Ctrl+K`). Non-git directory. |
| `D:\Projects\8-NomaanOS-Nexus-AI` | Target workspace for NomaanOS Nexus AI platform | Dedicated root for Nexus AI | Clean directory workspace designated for Nexus AI architecture, documentation, and implementation. |
| Other directories (`1-Note-Application` to `5-AI-Complaints`) | Legacy / standalone utilities | Python / React / Vue variants | Historical/experimental projects; outside the core NomaanOS enterprise ecosystem. |

---

## 3. Deep Dive: NomaanOS Sentinel Architecture

Sentinel is the most mature platform in the ecosystem. Its architectural choices provide direct reference conventions for Nexus AI.

### 3.1 Runtime, Language & Packaging Conventions
- **API Runtime**: Node.js 20+ with native ECMAScript Modules (`"type": "module"` in `apps/api/package.json`).
- **Language**: TypeScript 5.8 configured with strict type-checking, compiling to `dist/`.
- **Development Tooling**: `tsx watch src/server.ts` for rapid development without separate build steps.
- **Testing**: `vitest` for API unit and integration tests (`vitest run --fileParallelism=false`).
- **Python Services**: Python 3.10+ using standard `pyproject.toml`, setuptools build backend, and `pytest`.

### 3.2 Database & Migration System
- **Database Engine**: PostgreSQL 16 Alpine running via Docker Compose (`container_name: nomaanos-sentinel-database`, published port `127.0.0.1:5433`).
- **Connection Pooling**: `pg.Pool` (using `pg` driver 8.13) configured with:
  - `max`: 20 connections
  - `idleTimeoutMillis`: 30,000ms
  - `connectionTimeoutMillis`: 3,000ms
  - Error monitoring on idle clients
  - Connectivity probe helper `checkDatabaseConnection(timeoutMs)` with credential URI redaction (`postgresql://[REDACTED]@...`).
- **Migration Strategy**: Transactional, dependency-free raw SQL migrations managed by `apps/api/src/database/migrate.ts`.
  - Migration files located in `database/migrations/*.sql` sorted alphabetically.
  - Table `schema_migrations` tracks applied versions (`version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ`).
  - Executed inside a single `BEGIN ... COMMIT` block with automatic rollback on error.

### 3.3 Multi-Tenant Identity, Authentication & RBAC
- **Identity Storage**: `users` table with UUID v4 primary keys (`gen_random_uuid()`), unique case-insensitive email index (`LOWER(email)`), and bcrypt password hashing.
- **Session Security**: Server-managed cookie-based authentication:
  - `sessions` table tracks `session_token_hash VARCHAR(64)` (SHA-256 of opaque token).
  - Tokens transmitted in `HttpOnly`, `SameSite=Lax`, signed/secure cookies named `sentinel_session` (or `Authorization: Bearer <token>`).
  - Sliding session expiration (default 7 days).
- **Tenant Hierarchy**:
  - `organizations`: Top-level tenant container (`id`, `name`, `slug`, `created_by`, `metadata`).
  - `workspaces`: Individual operational boundary (`id`, `name`, `slug`, `organization_id`, `created_by`).
  - `workspace_memberships` and `organization_memberships`: Maps users to tenants with hierarchical RBAC.
- **Role Hierarchy**:
  $$\text{owner} (4) > \text{admin} (3) > \text{analyst} (2) > \text{viewer} (1)$$
  - Evaluated via `isRoleSufficient(userRole, requiredRole)`.
  - Tenant context resolved via URL param `:workspaceId` or `x-workspace-id` header with UUID regex validation.

### 3.4 Asynchronous Worker & Queue Architecture
- **Durable Job Queue**: Completely PostgreSQL-backed via `apps/api/src/services/queue.ts` without external Redis or RabbitMQ dependencies:
  - Atomic job acquisition using `FOR UPDATE SKIP LOCKED`.
  - Durable lease expiration: jobs with `lease_expires_at < NOW()` are automatically recovered if a worker process crashes.
  - Attempt counter (`attempts`, `max_attempts`) to handle transient failures vs poisoned jobs.
- **Process Orchestration**: API server coordinates child processes (e.g. Python CLI) or background loop runners while preserving database transactions.

### 3.5 AI Integration in Sentinel
Sentinel contains an existing AI module (`apps/api/src/services/ai-provider.ts` and `ai-investigator.ts`):
- **Provider Adapters**: Gemini (`gemini-1.5-pro` via native fetch), OpenAI (`gpt-4o-mini`), and `MockAiProvider` for offline testing.
- **Prompt Injection Defense**: Strict demarcation of untrusted telemetry inside `<evidence>` blocks; system instructions directing model to ignore instructions inside evidence.
- **Structured Schema & Citation Enforcement**: Requires response to match a strict JSON schema and verifies that cited IDs exist in the sanitized evidence allowlist.
- **Limitation**: Designed for one-off structured investigation reports against structured log events, not general conversational chat, multi-document RAG, vector embeddings, streaming SSE, or autonomous tool execution.

---

## 4. Deep Dive: NomaanOS Dashboard Architecture

- **Stack**: Next.js 14.2.15 (App Router), React 18.3.1, Tailwind CSS 3.4.14.
- **Role in Ecosystem**: Serves as the modern operational portal for NomaanOS cybersecurity administrators.
- **Integration Target**: Ideal primary candidate for integrating the **Universal Chat Widget**, verifying host embeddability, cross-origin security, theming, and real-time interaction.

---

## 5. Reusable Components & Modules

The following architectural components from Sentinel are directly reusable for Nexus AI:

1. **Authentication & Session Schema Patterns**:
   - `users`, `sessions`, `email_verification_tokens`, `password_reset_tokens`.
   - SHA-256 session token hashing and cookie validation logic.
2. **Multi-Tenant Organization & Workspace Hierarchy**:
   - Two-tier tenant isolation model (`organizations` -> `workspaces` -> `memberships`).
   - Role hierarchy (`owner`, `admin`, `analyst`, `viewer`).
3. **PostgreSQL Migration Engine**:
   - Transactional, dependency-free `migrate.ts` runner using `database/migrations/*.sql`.
4. **PostgreSQL Pool & Healthcheck Pattern**:
   - Safe `pg.Pool` configuration and sanitized `checkDatabaseConnection` latency probes.
5. **Durable Job Queue Pattern (`FOR UPDATE SKIP LOCKED`)**:
   - Zero-dependency transactional job queue with lease timeouts for the Python Document Ingestion Worker.
6. **Logging & Correlation Middleware**:
   - `pino` + `pino-http` structured JSON logger with automated credential/secret redaction.
7. **Mock AI Provider Architecture**:
   - Deterministic test harness pattern allowing 100% offline unit/integration test execution.

---

## 6. Architectural Gaps & Limitations to Address

1. **Absence of Vector Support in Sentinel's Postgres**:
   - Sentinel uses standard `postgres:16-alpine`. This image lacks the `pgvector` extension.
   - **Nexus AI Requirement**: Must use `pgvector/pgvector:pg16` or install the extension to support vector similarity operations (`HNSW` / `IVFFlat`).
2. **Database Separation & Coupling Risk**:
   - Sharing Sentinel's live database `nomaanos_sentinel` directly for Nexus AI tables would create dangerous coupling, shared connection contention, and unified blast radius.
   - **Recommendation**: Dedicated database `nomaanos_nexus_ai` with its own connection pool and migration lineage.
3. **No Document Ingestion Pipeline**:
   - Sentinel only parses syslog files (`services/parser`). Nexus AI requires ingestion of Markdown, PDF, TXT, HTML, and structured documents with layout-aware chunking and token counting.
4. **No Streaming SSE Protocol**:
   - Sentinel uses standard request-response JSON. Nexus AI requires Server-Sent Events (SSE) for token-by-token streaming, citation delivery, and cancellation.

---

## 7. Recommended Repository & Deployment Architecture

### Evaluated Options:
- **Option A: Dedicated Nexus AI Repository (`8-NomaanOS-Nexus-AI`)** [RECOMMENDED]
  - *Pros*: Clear ownership boundaries; independent CI/CD; isolated database migrations; no coupling to Sentinel's deployment cycle; produces embeddable widget bundle consumed by Sentinel, Dashboard, and external apps.
  - *Cons*: Shared types must be published or distributed via npm/package boundary.
- **Option B: Sub-application inside Sentinel Monorepo**
  - *Pros*: Immediate code sharing without package registry.
  - *Cons*: Violates single-responsibility principle; couples Nexus AI lifecycle to Sentinel; complicates independent scaling and deployment for non-Sentinel use cases.
- **Option C: Unified Giant NomaanOS Monorepo**
  - *Pros*: Everything in one git tree.
  - *Cons*: Heavy migration effort required to merge active repos; premature complexity for small team; Sentinel is an active production repo.

### Recommendation:
Adopt **Option A: Dedicated Monorepo for Nexus AI (`8-NomaanOS-Nexus-AI`)** configured with npm workspaces:
- `apps/admin`: Administrative Dashboard (Next.js 14)
- `apps/widget-demo`: Widget Integration Showcase (Vite / React)
- `packages/widget`: Universal Embeddable Chat Widget (Vite library build + React component)
- `packages/shared-types`: Canonical contracts, events, schemas, and API interfaces
- `services/api`: Nexus AI Core API (Node.js / Express / TypeScript modular monolith)
- `services/ingestion-worker`: Document Parsing, Chunking & Embedding Worker (Python 3.12)
- `database/migrations`: Dedicated pgvector-enabled SQL schema migrations

This keeps Nexus AI fully decoupled, independently deployable, and capable of serving the entire NomaanOS ecosystem.

