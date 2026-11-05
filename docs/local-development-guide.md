# NomaanOS Nexus AI — Local Development & Operations Guide

## 1. Prerequisites

Ensure the following runtimes and tools are installed:
- **Node.js**: v20.0.0 or later (v24 LTS recommended)
- **NPM**: v10.0.0 or later (Use `npm.cmd` on Windows PowerShell if execution policies restrict `.ps1` scripts)
- **Docker & Docker Compose**: Docker 26+ / Compose v2.20+ with Docker Desktop running
- **Git**

---

## 2. Quick Start (Zero to Ready)

### Step 1: Clone and Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Verify key variables in `.env`:
- `API_PORT=4001`
- `DATABASE_PORT=5434` (Avoids conflicts with Sentinel's 5433 or default Postgres 5432)
- `DATABASE_NAME=nomaanos_nexus_ai`
- `DATABASE_USER=nexus_dev`
- `DATABASE_PASSWORD=nexus_local_dev_secret_2026`

### Step 2: Install Workspace Dependencies
```bash
npm install
```
*(On Windows PowerShell, use `npm.cmd install`)*

### Step 3: Build Shared Packages
```bash
npm run build
```

### Step 4: Start PostgreSQL with pgvector
```bash
npm run db:up
```
This launches the container `nomaanos-nexus-database` running `pgvector/pgvector:pg16` on `127.0.0.1:5434`.

Verify container health:
```bash
docker ps -f name=nomaanos-nexus-database
```
Status should report `Up (healthy)`.

### Step 5: Run Database Migrations
```bash
npm run db:migrate
```
Applies all unapplied SQL scripts in `database/migrations/` transactionally and records them in `schema_migrations`.

Check migration status:
```bash
npm run db:status
```

### Step 6: Run Automated Tests
```bash
npm test
```
Executes the Vitest test suite covering environment validation, logger sensitive data redaction, API health/readiness endpoints, migration idempotency, and pgvector cosine similarity operations.

### Step 7: Start API Server in Development Mode
```bash
npm run dev:api
```
The server will start at `http://localhost:4001` with hot-reloading enabled via `tsx watch`.

Verify liveness and readiness:
```bash
curl http://localhost:4001/health
# {"status":"ok","service":"nexus-ai-api","timestamp":"..."}

curl http://localhost:4001/ready
# {"status":"ready","checks":{"database":"ok","pgvector":"ok"},"latencyMs":...}
```

---

## 3. Database Management & Schema Lifecycle

### Migration Commands
| Command | Action |
|---|---|
| `npm run db:migrate` | Applies all pending migrations in alphabetical order within an ACID transaction. |
| `npm run db:status` | Displays whether each migration is `[APPLIED]` or `[PENDING]`. |
| `npm run db:sync-user` | Synchronizes the database user and password from `.env` with the existing PostgreSQL instance without resetting data. |
| `npm run db:up` | Starts the PostgreSQL Docker container in the background. |
| `npm run db:down` | Stops the PostgreSQL container gracefully. |
| `npm run db:reset` | **Destructive**: Tears down the container and wipes the `nexus_postgres_data` volume, then restarts a clean instance. |

### Schema Conventions
- All IDs use UUID v4 (`gen_random_uuid()`).
- All timestamps use UTC `TIMESTAMPTZ` defaulting to `NOW()`.
- Every operational table includes foreign keys cascading to parent workspaces.
- Document chunks contain:
  - `embedding vector(768)`: Tuned for `nomic-embed-text` with HNSW cosine similarity indexing (`vector_cosine_ops`).
  - `tsv TSVECTOR`: Generated always stored English language lexemes with GIN indexing.

---

## 4. Troubleshooting Common Issues

### Issue 1: Port Conflict on Database (Error: `bind: address already in use`)
- **Cause**: Another service or PostgreSQL instance is bound to port `5434`.
- **Solution**: Check running ports using `netstat -ano | findstr 5434` or modify `DATABASE_PORT` in `.env` and `docker-compose.yml` to another free port (e.g., `5435`).

### Issue 2: Docker Desktop API connection error (`npipe:////./pipe/dockerDesktopLinuxEngine`)
- **Cause**: Docker Desktop daemon is not running or suspended.
- **Solution**: Start Docker Desktop from the Start Menu or via command line:
  ```powershell
  Start-Process "C:\Users\<user>\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"
  ```
  Wait 15–20 seconds for the Linux engine to initialize before running `docker compose up -d`.

### Issue 3: PowerShell Script Execution Policy (`npm.ps1 cannot be loaded`)
- **Cause**: Windows ExecutionPolicy is set to `Restricted`.
- **Solution**: Run `npm.cmd` instead of `npm`, or open PowerShell as administrator and set `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Issue 4: Migration Rollback on SQL Error
- **Cause**: A syntax error or violated constraint in a migration file.
- **Behavior**: Nexus AI migrations execute inside `BEGIN ... COMMIT`. If any statement fails, the entire transaction rolls back automatically and zero partial schema changes persist.
- **Solution**: Fix the offending SQL script and re-run `npm run db:migrate`.

### Issue 5: PostgreSQL Authentication Failure (Error: `28P01` password authentication failed)
- **Cause**: Changing `DATABASE_USER` or `DATABASE_PASSWORD` in `.env` after the PostgreSQL Docker volume has already been initialized. PostgreSQL only runs `initdb` and creates the initial user once on an empty volume; subsequent changes to `.env` do not automatically alter existing PostgreSQL catalog users.
- **Safe Solution (Preserves All Data)**:
  Run the automated user synchronization script:
  ```bash
  npm run db:sync-user
  ```
  This creates/updates the configured role and grants permissions in the existing database without touching or resetting the volume. Afterwards, re-run `npm run db:migrate`.

