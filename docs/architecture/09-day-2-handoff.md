# Deliverable I: Day 2 Implementation Handoff & Action Plan

## 1. Executive Summary & Objective

Day 1 established the complete architecture specification, repository audit, entity data model, versioned API contracts, security threat model, feature-to-test matrix, and 18 Architectural Decision Records (ADRs).

**Day 2 Objective**: Lay the core technical foundation of the Nexus AI platform following the verified conventions of the NomaanOS ecosystem without guessing.

> [!IMPORTANT]
> Do NOT implement live LLM integrations, document parsers, or the React chat widget on Day 2. Focus strictly on the database engine, migrations, configuration validation, structured logging, health probes, shared types, and automated foundation tests.

---

## 2. Day 2 Scope of Work & Deliverables

### Task 1: Repository & Workspace Scaffolding
- Initialize the root `package.json` with npm workspaces:
  ```json
  {
    "name": "nomaanos-nexus-ai",
    "version": "0.1.0",
    "private": true,
    "workspaces": [
      "apps/*",
      "packages/*",
      "services/*"
    ],
    "scripts": {
      "dev:api": "npm run dev --workspace=services/api",
      "build": "npm run build --workspaces --if-present",
      "test": "npm run test:api",
      "test:api": "npm run test --workspace=services/api",
      "db:up": "docker compose up -d database",
      "db:down": "docker compose down",
      "db:migrate": "npm run migrate --workspace=services/api"
    }
  }
  ```
- Configure root `.gitignore` ensuring `node_modules`, `.env`, `dist`, `.venv`, and `coverage` are never committed.
- Create `.env.example` defining database ports, session secrets, and log levels with zero live credentials.

### Task 2: PostgreSQL 16 + pgvector Docker Environment
- Create `docker-compose.yml` specifying a dedicated container for Nexus AI:
  - **Image**: `pgvector/pgvector:pg16`
  - **Container Name**: `nomaanos-nexus-database`
  - **Database Name**: `nomaanos_nexus_ai`
  - **Port Binding**: Strictly bound to localhost: `127.0.0.1:${DATABASE_PORT:-5434}:5432` (Note: port 5434 avoids collision with Sentinel's 5433).
  - **Volume**: `nexus_postgres_data:/var/lib/postgresql/data`
  - **Healthcheck**: `pg_isready -U ${DATABASE_USER:-nexus_dev} -d ${DATABASE_NAME:-nomaanos_nexus_ai}`

### Task 3: Shared TypeScript Types Package (`packages/shared-types`)
- Create `packages/shared-types/src/index.ts` declaring:
  - Tenant and User contexts (`Organization`, `Workspace`, `User`, `RoleHierarchy`).
  - Assistant and Knowledge Space interfaces.
  - SSE Protocol event payloads (`MessageStartEvent`, `ContentDeltaEvent`, `CitationsEvent`, `MessageCompleteEvent`).
  - Standard API error and pagination interfaces.

### Task 4: Database Migrations Engine & Schema 001
- Build `services/api/src/database/migrate.ts` matching Sentinel's transactional migration pattern:
  - Tracks applied files in `schema_migrations`.
  - Executes inside a transaction (`BEGIN ... COMMIT`).
- Create initial migration `database/migrations/001_create_nexus_foundation.sql`:
  - `CREATE EXTENSION IF NOT EXISTS vector;`
  - `CREATE TABLE organizations (...)`
  - `CREATE TABLE workspaces (...)`
  - `CREATE TABLE users (...)`
  - `CREATE TABLE sessions (...)`
  - `CREATE TABLE assistants (...)`
  - `CREATE TABLE knowledge_spaces (...)`
  - `CREATE TABLE document_sources (...)`
  - `CREATE TABLE document_chunks (...)` with `tsv TSVECTOR` and `vector(768)` columns.
  - Mandatory foreign keys, unique constraints, and indexes.

### Task 5: Core API Foundation (`services/api`)
- Setup `services/api/package.json` with ESM (`"type": "module"`), Node 20+, Express 4.21, TypeScript 5.8, `pg`, `pino`, `pino-http`, `cookie-parser`, `tsx`, and `vitest`.
- Implement `services/api/src/config/env.ts` with strict Zod/Ajv configuration validation and descriptive startup errors if required variables are missing.
- Implement `services/api/src/config/logger.ts` with Pino structured logging and automated credential redaction.
- Implement `services/api/src/database/pool.ts` with connection pooling, idle client error handlers, and the `checkDatabaseConnection` probe.
- Implement `services/api/src/routes/health.ts`:
  - `GET /health` (Process liveness).
  - `GET /ready` (Downstream PostgreSQL and pgvector readiness).
- Implement `services/api/src/middleware/request-logger.ts` with correlation ID generation (`X-Correlation-Id`).
- Implement `services/api/src/middleware/error-handler.ts` sanitizing internal database error strings.

### Task 6: Automated Foundation Test Suite
- Configure Vitest in `services/api/vitest.config.ts`.
- Write unit and integration tests:
  1. `health.test.ts`: Asserts 200 OK on `/health` and verifies `/ready` accurately reflects database status.
  2. `migrate.test.ts`: Asserts migrations execute in order and record in `schema_migrations`.
  3. `redaction.test.ts`: Asserts passwords, bearer tokens, and session hashes are redacted from logs.
  4. `config.test.ts`: Asserts invalid port or missing session secret throws descriptive startup errors.

---

## 3. Day 2 Acceptance Checklist

The coding agent beginning Day 2 must satisfy the following verifiable criteria:

- [ ] `docker compose up -d database` launches `pgvector/pgvector:pg16` successfully.
- [ ] `npm run db:migrate` runs and applies `001_create_nexus_foundation.sql` without errors.
- [ ] Database query `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';` confirms pgvector is active.
- [ ] `npm run dev:api` starts the server on configured port (e.g. 4001).
- [ ] `curl -i http://localhost:4001/health` returns `{"status":"ok","service":"nexus-ai-api"}`.
- [ ] `curl -i http://localhost:4001/ready` returns `{"status":"ready","checks":{"database":"ok","pgvector":"ok"}}`.
- [ ] `npm test` passes 100% of the foundation test suite.
- [ ] Zero secrets or API keys are exposed in logs or environment examples.

