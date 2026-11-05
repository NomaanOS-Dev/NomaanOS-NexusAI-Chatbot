# NomaanOS Nexus AI — Comprehensive Testing Guide

**Document:** `test.md`  
**Purpose:** Central, progressive testing manual starting from **Day 6** onwards. As subsequent days are implemented, additional test procedures will be appended to this document.

---

# Table of Contents
- [Prerequisites & System Requirements](#prerequisites--system-requirements)
- [Day 6: Knowledge Source Registration, Secure Document Upload & Extraction](#day-6-knowledge-source-registration-secure-document-upload--extraction)
  - [1. Environment Setup & Rebuild Commands](#1-environment-setup--rebuild-commands)
  - [2. Automated Test Execution](#2-automated-test-execution)
  - [3. Interactive / Live API Manual Walkthrough](#3-interactive--live-api-manual-walkthrough)
    - [Step 3.1: Start the API Server](#step-31-start-the-api-server)
    - [Step 3.2: Register a Test User & Obtain Bearer Token](#step-32-register-a-test-user--obtain-bearer-token)
    - [Step 3.3: Create a Knowledge Space](#step-33-create-a-knowledge-space)
    - [Step 3.4: Test Document Uploads (All Supported Formats)](#step-34-test-document-uploads-all-supported-formats)
    - [Step 3.5: Test Security Validations & Error Handling](#step-35-test-security-validations--error-handling)
    - [Step 3.6: Test Tenant Isolation & Cross-Workspace Boundaries](#step-36-test-tenant-isolation--cross-workspace-boundaries)
    - [Step 3.7: Inspect Database Persistence & Private Storage](#step-37-inspect-database-persistence--private-storage)
  - [4. Day 6 Verification Scorecard & Checklist](#4-day-6-verification-scorecard--checklist)

---

## Prerequisites & System Requirements

Ensure the following runtimes are installed on your machine:
- **Node.js**: v20.x or v22.x+ (verify with `node -v`)
- **Python**: v3.10+ or v3.12+ (verify with `python --version`)
- **Docker**: Docker Desktop running (for PostgreSQL 16 + pgvector)
- **PowerShell** or **Bash** terminal

---

# Day 6: Knowledge Source Registration, Secure Document Upload & Extraction

Day 6 implements the document ingestion and extraction foundation:
- Secure multipart file upload with size, extension, and MIME magic byte validation.
- Extensible Python parser service (`nexus-parser`) supporting:
  - Plain Text (`.txt`)
  - Markdown (`.md`)
  - HTML (`.html`, `.htm`)
  - PDF (`.pdf`)
  - OpenAPI Specifications (`.json`, `.yaml`, `.yml`)
  - Approved JSON Documents (`.json`)
- Extraction lifecycle: `uploaded` ➔ `processing` ➔ `completed` \| `completed_with_warnings` \| `failed`.
- Private file storage outside web roots (`storage/documents/<workspaceId>/<sourceId>/`).
- Version tracking in `document_versions` and audit logging.

---

## 1. Environment Setup & Rebuild Commands

Run these commands in PowerShell from the project root (`d:\Projects\8-NomaanOS-Nexus-AI`):

### 1.1 Install Python Parser Dependencies
Ensure the parser dependencies (`pypdf`, `pyyaml`, `pytest`) are installed:
```powershell
python -m pip install pypdf pyyaml pytest
```

### 1.2 Start the PostgreSQL 16 Database
Start the Docker container running PostgreSQL with pgvector on port 5434:
```powershell
npm.cmd run db:up
```
*Expected output:* Container `nomaanos-nexus-database` is started or running.

### 1.3 Run Database Migrations
Apply all migrations up to migration 004 (`004_enhance_document_sources_day6.sql`):
```powershell
npm.cmd run db:migrate
```
*Expected output:*
```text
Applying database migration: 004_enhance_document_sources_day6.sql
Migration execution completed
```

Verify migration status:
```powershell
npm.cmd run db:status
```
*Expected output:*
```text
 [APPLIED] 001_create_nexus_foundation.sql
 [APPLIED] 002_create_provider_credentials.sql
 [APPLIED] 003_create_message_feedback.sql
 [APPLIED] 004_enhance_document_sources_day6.sql
```

### 1.4 Rebuild Monorepo Workspaces
Compile TypeScript for all packages and the API service:
```powershell
npm.cmd run build
```
*Expected output:*
```text
> @nomaanos/widget-demo build (built)
> @nomaanos/nexus-shared-types build (tsc)
> @nomaanos/nexus-widget build (Nexus Widget build completed successfully!)
> @nomaanos/nexus-api build (tsc)
```

---

## 2. Automated Test Execution

You can run automated test suites covering both the Python parser service and the Node.js API.

### 2.1 Run Python Document Parser Tests (22 Unit Tests)
```powershell
npm.cmd run test:parser
# or directly:
python -m pytest services/parser/tests
```
*Expected output:*
```text
services\parser\tests\test_cli.py .                                      [  4%]
services\parser\tests\test_html.py ..                                    [ 13%]
services\parser\tests\test_json.py ...                                   [ 27%]
services\parser\tests\test_markdown.py ..                                [ 36%]
services\parser\tests\test_openapi.py ....                               [ 54%]
services\parser\tests\test_pdf.py ...                                    [ 68%]
services\parser\tests\test_plain_text.py ...                             [ 81%]
services\parser\tests\test_security.py ....                              [100%]

============================= 22 passed in ~0.15s ==============================
```

### 2.2 Run Node.js API Test Suite (117 Integration Tests)
```powershell
npm.cmd run test:api
```
*Expected output:*
```text
 Test Files  9 passed (9)
      Tests  117 passed (117)
```

### 2.3 Run All Tests Combined (139 Tests Total)
```powershell
npm.cmd run test:all
```
*Expected output:* Both Python parser tests (22) and Node.js API tests (117) pass with **100% pass rate**.

---

## 3. Interactive / Live API Manual Walkthrough

Follow these steps to manually test Day 6 file upload and document extraction end-to-end.

### Step 3.1: Start the API Server
In **Terminal 1**, start the development server:
```powershell
npm.cmd run dev:api
```
*Expected output:*
```text
Server listening at http://127.0.0.1:4001
[Nexus AI API] Ready and initialized on port 4001
```

---

### Step 3.2: Register a Test User & Obtain Bearer Token
In **Terminal 2**, register a test user to obtain a workspace and auth token:

```powershell
$regResponse = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
    email = "day6-tester@example.com";
    password = "TestPassword123!";
    fullName = "Day 6 QA Tester";
    organizationName = "QA Ingestion Corp"
  } | ConvertTo-Json)

$TOKEN = $regResponse.token
$WORKSPACE_ID = $regResponse.workspace.id

Write-Host "Auth Token: $TOKEN"
Write-Host "Workspace ID: $WORKSPACE_ID"
```
*(If the user already exists, use `/api/v1/auth/login` to obtain a fresh token).*

---

### Step 3.3: Create a Knowledge Space
Create an active Knowledge Space to receive document sources:

```powershell
$spaceResponse = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    name = "Day 6 Test Knowledge Space";
    slug = "day6-test-space";
    description = "Knowledge space for testing Day 6 document uploads"
  } | ConvertTo-Json)

$SPACE_ID = $spaceResponse.knowledgeSpace.id
Write-Host "Knowledge Space ID: $SPACE_ID"
```

---

### Step 3.4: Test Document Uploads (All Supported Formats)

Create a temporary directory for sample documents:
```powershell
New-Item -ItemType Directory -Force -Path "./temp_test_docs"
```

#### Test 3.4.1: Plain Text Document (`.txt`)
Create and upload a `.txt` file:
```powershell
"NomaanOS Nexus AI Platform Architecture`n`nHigh-performance retrieval engine with pgvector multi-tenant isolation." | Out-File -Encoding utf8 "./temp_test_docs/sample.txt"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/sample.txt" `
  -F "title=Platform Architecture"
```
*Expected Response:*
- HTTP `201 Created`
- `source.status`: `"completed"`
- `source.mimeType`: `"text/plain"`
- `source.filename`: `"sample.txt"`

---

#### Test 3.4.2: Markdown Document (`.md`)
Create and upload a `.md` file with headings, lists, tables, and code blocks:
```powershell
@"
# Incident Response Guide
Emergency containment procedure.

## Step 1: Containment
Isolate compromised hosts immediately.

\`\`\`bash
iptables -A INPUT -p tcp --dport 22 -j DROP
\`\`\`

## Step 2: Severity Matrix
| Level | Response SLA |
|-------|--------------|
| Critical | 15 mins |
| High | 1 hour |
"@ | Out-File -Encoding utf8 "./temp_test_docs/runbook.md"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/runbook.md"
```
*Expected Response:*
- HTTP `201 Created`
- `source.title`: `"Incident Response Guide"` (automatically parsed from the top `#` heading)
- `source.status`: `"completed"`
- `extraction.blocksCount`: `>= 3`

---

#### Test 3.4.3: HTML Document (`.html`) with Security Script Stripping
Create and upload an HTML file containing embedded `<script>` and `<style>` tags:
```powershell
@"
<!DOCTYPE html>
<html>
<head>
  <title>Cloud Infrastructure SOP</title>
  <style>body { color: red; }</style>
  <script>alert('Attempting XSS');</script>
</head>
<body>
  <h1>Database Failover Runbook</h1>
  <p>Step-by-step failover procedure for PostgreSQL 16 cluster.</p>
</body>
</html>
"@ | Out-File -Encoding utf8 "./temp_test_docs/sop.html"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/sop.html"
```
*Expected Response:*
- HTTP `201 Created`
- `source.title`: `"Cloud Infrastructure SOP"`
- `source.status`: `"completed_with_warnings"`
- `source.warnings`: Contains warning `STRIPPED_SCRIPTS` ("Stripped 1 <script> element(s) for security").
- Notice: Scripts and styles were safely discarded; raw execution is prevented.

---

#### Test 3.4.4: Approved JSON Document (`.json`)
Create and upload structured JSON data:
```powershell
@"
{
  "title": "PostgreSQL Cluster Config",
  "environment": "production",
  "primaryHost": "db-primary.local",
  "replicas": ["db-replica-01.local", "db-replica-02.local"],
  "maxConnections": 100
}
"@ | Out-File -Encoding utf8 "./temp_test_docs/cluster.json"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/cluster.json"
```
*Expected Response:*
- HTTP `201 Created`
- `source.status`: `"completed"`
- `source.title`: `"PostgreSQL Cluster Config"`

---

#### Test 3.4.5: OpenAPI Specification (`.yaml`)
Create and upload an OpenAPI 3.0 specification:
```powershell
@"
openapi: "3.0.3"
info:
  title: "Sentinel Telemetry Ingestion API"
  version: "1.0.0"
paths:
  /api/v1/events:
    post:
      summary: "Ingest Security Events"
      responses:
        "200":
          description: "Events accepted"
"@ | Out-File -Encoding utf8 "./temp_test_docs/openapi.yaml"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/openapi.yaml"
```
*Expected Response:*
- HTTP `201 Created`
- `source.title`: `"Sentinel Telemetry Ingestion API"`
- `source.status`: `"completed"`

---

### Step 3.5: Test Security Validations & Error Handling

#### Test 3.5.1: Reject Empty File (0 Bytes)
```powershell
# Create an empty 0-byte file
New-Item -Force -Path "./temp_test_docs/empty.txt"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/empty.txt"
```
*Expected Response:*
```json
{"error":"DocumentProcessingError","message":"Uploaded file is completely empty (0 bytes).","statusCode":400}
```

---

#### Test 3.5.2: Reject Unsupported File Extension (`.exe`)
```powershell
"MZ binary payload" | Out-File -Encoding utf8 "./temp_test_docs/malware.exe"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/malware.exe"
```
*Expected Response:*
- HTTP `415 Unsupported Media Type`
- Message: `"Unsupported file extension '.exe'. Allowed extensions: ..."`

---

#### Test 3.5.3: Reject Spoofed PDF (Missing `%PDF-` Header)
```powershell
"This is plain text pretending to be a PDF" | Out-File -Encoding utf8 "./temp_test_docs/fake.pdf"

curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/fake.pdf"
```
*Expected Response:*
- HTTP `400 Bad Request`
- Message: `"MIME/content mismatch: File has .pdf extension but lacks the valid '%PDF-' header signature."`

---

#### Test 3.5.4: Path Traversal Sanitization
Test attempting directory traversal in filename:
```powershell
curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@./temp_test_docs/sample.txt;filename=../../../../etc/passwd.txt"
```
*Expected Response:*
- HTTP `201 Created`
- `source.filename`: `"passwd.txt"` (path traversal `../../../../` is completely stripped).

---

### Step 3.6: Test Tenant Isolation & Cross-Workspace Boundaries

#### Test 3.6.1: List Sources in Current Workspace
```powershell
curl.exe -s "http://localhost:4001/api/v1/knowledge-sources?knowledgeSpaceId=$SPACE_ID" `
  -H "Authorization: Bearer $TOKEN" `
  -H "X-Workspace-Id: $WORKSPACE_ID"
```
*Expected Response:* Lists only the documents uploaded in your workspace.

#### Test 3.6.2: Unauthenticated Query
```powershell
curl.exe -s "http://localhost:4001/api/v1/knowledge-sources"
```
*Expected Response:* `HTTP 401 Unauthorized`.

#### Test 3.6.3: Cross-Workspace Access Returns 404
Attempting to fetch a document source from another workspace without membership returns `404 Not Found` (never leaking existence across tenants).

---

### Step 3.7: Inspect Database Persistence & Private Storage

#### Inspect PostgreSQL Database Records
Run a quick query via Node to verify records in `document_sources` and `document_versions`:
```powershell
node -e "
const { pool } = require('./services/api/dist/database/pool.js');
async function check() {
  const sources = await pool.query('SELECT id, title, filename, status, sha256, extraction_warnings FROM document_sources ORDER BY created_at DESC LIMIT 5;');
  console.log('Latest Document Sources:');
  console.table(sources.rows);
  const versions = await pool.query('SELECT id, source_id, version_number, sha256 FROM document_versions ORDER BY created_at DESC LIMIT 5;');
  console.log('Latest Document Versions:');
  console.table(versions.rows);
  process.exit(0);
}
check();
"
```
*Expected Output:* Shows your uploaded documents with `status = 'completed'` or `'completed_with_warnings'`, accurate `sha256` checksums, and version `1`.

#### Inspect Private Storage on Disk
Verify that documents are saved in private directories outside public web roots:
```powershell
Get-ChildItem -Path "storage/documents" -Recurse
```
*Expected Output:* Stored under `storage/documents/<workspaceId>/<sourceId>/<UUID>_<filename>`, inaccessible via public web routes.

#### Cleanup Temporary Sample Docs
```powershell
Remove-Item -Recurse -Force "./temp_test_docs"
```

---

## 5. Day 16 — Local Model Inference Verification Walkthrough

Nexus AI Day 16 establishes local model inference support via **Ollama** and provider-independent abstraction with zero-cloud execution enforcement.

### 5.1 Automated Test Execution

Run the dedicated Day 16 test suite:
```powershell
cmd.exe /c "cd services\api && npx vitest run tests/day16-local-model-inference.test.ts"
```
*Expected Output:* 15 tests pass across provider instantiation, local-only policy enforcement, model health & discovery, streaming & timeout cancellation, JSON structured mode, and grounded RAG synthesis.

### 5.2 Manual Verification with PowerShell

#### Step 1: Check Local Inference Health & Policy
```powershell
$health = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/health" -Method Get
$health | ConvertTo-Json -Depth 4
```
*Expected Output:*
```json
{
  "status": "healthy",
  "provider": "ollama",
  "localOnly": true,
  "activeModel": "qwen3.8:27b",
  "modelsAvailable": [
    "qwen3.8:27b"
  ],
  "details": {
    "baseUrl": "http://127.0.0.1:11434",
    "keepAlive": "5m",
    "timeoutMs": 60000
  }
}
```

#### Step 2: List Discovered Local Models
```powershell
$models = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/models" -Method Get
$models.models | Format-Table -Property name, size, digest, modifiedAt
```

#### Step 3: Test Local Inference Generation Endpoint
```powershell
$headers = @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer $TOKEN"
}

$body = @{
  prompt = "Provide a three-sentence summary of the principle of least privilege."
  temperature = 0.2
} | ConvertTo-Json

$gen = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/generate" -Method Post -Headers $headers -Body $body
$gen.response.content
```

#### Step 4: Verify Zero Cloud Leakage Policy
Attempt to route a request to an external cloud provider (`openai` or `anthropic`) while `LOCAL_INFERENCE_ONLY=true`:
```powershell
try {
  $cloudBody = @{
    prompt = "Hello cloud"
    provider = "openai"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/generate" -Method Post -Headers $headers -Body $cloudBody
} catch {
  Write-Host "Blocked as expected with code: " $_.Exception.Response.StatusCode.value__
}
```
*Expected Output:* HTTP 403 Forbidden with message indicating cloud routing is strictly disabled.

---

## 6. Day 16 Verification Scorecard & Checklist

| # | Feature / Test Requirement | Verification Target | Expected Result | Status |
|---|---|---|---|:---:|
| 1 | **Provider Abstraction** | `InferenceProvider` interface | Polymorphic dispatch across Ollama & Deterministic | ✅ Pass |
| 2 | **Local Ollama Integration** | `http://127.0.0.1:11434` | Connects, lists tags, streams completion | ✅ Pass |
| 3 | **Model Health Endpoint** | `GET /api/v1/inference/health` | HTTP 200 with provider status, models, and policy | ✅ Pass |
| 4 | **Model Discovery Endpoint** | `GET /api/v1/inference/models` | Discovers locally pulled Ollama models | ✅ Pass |
| 5 | **Local-Only Policy Guard** | `assertLocalInferencePolicy()` | Cloud requests blocked with HTTP 403 | ✅ Pass |
| 6 | **Streaming Generation** | SSE / onChunk streaming | Incremental tokens dispatched without buffering | ✅ Pass |
| 7 | **AbortController Signal** | Client abort / disconnect | Streaming loop terminates immediately, cleans up | ✅ Pass |
| 8 | **Timeout Protection** | `OLLAMA_TIMEOUT_MS` | Prevents hanging threads on stalled models | ✅ Pass |
| 9 | **Structured JSON Mode** | `format: 'json'` / Schema | Generates and validates clean JSON objects | ✅ Pass |
| 10 | **Grounded RAG Integration** | `synthesizeGroundedAnswerAsync` | Local LLM generates answers grounded with `[1]` citations | ✅ Pass |
| 11 | **Deterministic Fallback** | Fallback synthesis | Automatic fallback on offline/unreachable LLM | ✅ Pass |
| 12 | **Offline Guide** | `docs/local-inference.md` | Hardware sizing, model pulling, offline runbook | ✅ Pass |
| 13 | **Day 16 Vitest Suite** | `day16-local-model-inference.test.ts` | 15 / 15 unit and integration tests pass | ✅ Pass |

---

## 7. Day 17 — Cloud Inference & Model Routing Verification Walkthrough

Nexus AI Day 17 implements dynamic model routing across local, cloud, and hybrid inference providers with rate-limit circuit breakers, task complexity evaluation, and comprehensive usage telemetry.

### 7.1 Automated Test Execution

Run the dedicated Day 17 test suite:
```powershell
cmd.exe /c "cd services\api && npx vitest run tests/day17-cloud-inference-model-routing.test.ts"
```
*Expected Output:* 22 tests pass across cloud-provider adapters, credential protection, rate-limit cooldowns, task complexity evaluation, all four routing policies (`local-only`, `cloud-preferred`, `hybrid`, `cloud-only`), and telemetry recording.

### 7.2 Manual Verification with PowerShell

#### Step 1: Inspect Available Routing Policies
```powershell
$policies = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/policies" -Method Get
$policies.policies | Format-Table -Property id, name, cloudPermitted, description
```

#### Step 2: Query Provider Registry Health & Rate-Limit Status
```powershell
$health = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/health" -Method Get
$health.providers | Format-Table -Property provider, status, isCloud, currentModel
```

#### Step 3: Test Hybrid Routing via Task Complexity
```powershell
$headers = @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer $TOKEN"
}

# 3A. Simple inquiry -> Routes to local engine
$simpleBody = @{
  prompt = "Hello! What is your role?"
  policy = "hybrid"
} | ConvertTo-Json

$resSimple = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/generate" -Method Post -Headers $headers -Body $simpleBody
Write-Host "Simple Task Target:" $resSimple.routing.decision.targetProvider "(Complexity:" $resSimple.routing.decision.taskComplexity ")"

# 3B. Complex inquiry -> Routes to high-capacity cloud model
$complexBody = @{
  prompt = "Perform root cause analysis and incident triage for unauthorized privilege escalation: ```sql SELECT * FROM audit_logs ```"
  policy = "hybrid"
} | ConvertTo-Json

$resComplex = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/generate" -Method Post -Headers $headers -Body $complexBody
Write-Host "Complex Task Target:" $resComplex.routing.decision.targetProvider "(Complexity:" $resComplex.routing.decision.taskComplexity ")"
```

#### Step 4: Verify Local-Only Invariant Enforcement
Confirm that `local-only` mode strictly forbids cloud execution and never silently leaks queries to cloud providers:
```powershell
try {
  $leakTest = @{
    prompt = "Hello"
    policy = "local-only"
    provider = "openai"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/generate" -Method Post -Headers $headers -Body $leakTest
} catch {
  Write-Host "Cloud call strictly blocked with HTTP code:" $_.Exception.Response.StatusCode.value__
}
```
*Expected Output:* HTTP 403 Forbidden with `PolicyViolationError`.

#### Step 5: Query Observability & Telemetry Metrics
```powershell
$metrics = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/inference/metrics" -Method Get
$metrics.metrics | ConvertTo-Json -Depth 4
```

---

## 8. Day 17 Verification Scorecard & Checklist

| # | Feature / Test Requirement | Verification Target | Expected Result | Status |
|---|---|---|---|:---:|
| 1 | **OpenAI Cloud Adapter** | `OpenAIInferenceProvider` | Normalizes chat completions, tokens, and cost | ✅ Pass |
| 2 | **OpenAI Streaming SSE** | `generateStream()` | Parses `data: { delta }` chunks and `[DONE]` | ✅ Pass |
| 3 | **Anthropic Messages Adapter** | `AnthropicInferenceProvider` | Normalizes Claude messages API, tokens, cost | ✅ Pass |
| 4 | **Credential Protection** | `maskApiKey()` / AES-256-GCM | Masks keys (`sk-...1234`), zero leaks in diagnostics | ✅ Pass |
| 5 | **Rate-Limit Detection** | HTTP 429 & `Retry-After` | Parses cooldown, sets circuit breaker | ✅ Pass |
| 6 | **Task Complexity Analysis** | `evaluateTaskComplexity()` | Classifies into `simple`, `standard`, `complex` | ✅ Pass |
| 7 | **Policy 1: Local-Only** | Invariant Enforcement | Never calls cloud, zero silent fallback | ✅ Pass |
| 8 | **Policy 2: Cloud-Preferred** | Cloud with Fallback | Prefers cloud, falls back to local on failure | ✅ Pass |
| 9 | **Policy 3: Hybrid Routing** | Complexity & Sensitivity | Complex -> cloud; simple/sensitive -> local | ✅ Pass |
| 10 | **Policy 4: Cloud-Only** | Strict Cloud Execution | Fails if cloud down; zero local fallback | ✅ Pass |
| 11 | **Telemetry Database Tables** | `011_inference_routing_usage_day17.sql` | `inference_usage_records` & `inference_failures` | ✅ Pass |
| 12 | **Telemetry Metrics API** | `GET /api/v1/inference/metrics` | In-memory + PostgreSQL aggregated metrics | ✅ Pass |
| 13 | **Policies Discovery API** | `GET /api/v1/inference/policies` | Discovers all 4 routing policies and active mode | ✅ Pass |
| 14 | **Day 17 Vitest Suite** | `day17-cloud-inference-model-routing.test.ts` | 22 / 22 unit and integration tests pass | ✅ Pass |
| 15 | **Day 16 Vitest Regression** | `day16-local-model-inference.test.ts` | 15 / 15 unit and integration tests pass | ✅ Pass |

---

## 9. Day 18 — Disconnected Operation & Air-Gapped Deployment Walkthrough

Nexus AI Day 18 guarantees complete offline execution, zero remote egress, self-hosted frontend widget assets, and cryptographically verified knowledge package portability.

### 9.1 Automated Test Execution

Run the dedicated Day 18 test suite:
```powershell
cmd.exe /c "cd services\api && npx vitest run tests/day18-offline-operation.test.ts"
```
*Expected Output:* 13 / 13 tests pass (100%) verifying offline invariants, grounded RAG without external calls, live remote data indication, zero cloud leakage, knowledge package export/import with SHA-256 validation, and local widget asset serving.

### 9.2 Manual Verification with PowerShell

#### Step 1: Inspect Air-Gapped Readiness
```powershell
$status = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/offline/status" -Method Get
$status | ConvertTo-Json -Depth 4
```
*Expected Output:*
```json
{
  "status": "ok",
  "offline": {
    "offlineMode": true,
    "airGapped": true,
    "remoteDataAvailable": false,
    "localInferenceOnly": true,
    "activeInferenceProvider": "ollama",
    "embeddingDaemonActive": true,
    "databaseConnected": true,
    "vectorExtensionReady": true
  }
}
```

#### Step 2: Export Offline Knowledge Space Package
```powershell
$exportBody = @{
  knowledgeSpaceId = "$SPACE_ID"
  saveToDisk = $true
} | ConvertTo-Json

$pkg = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/offline/export" -Method Post -Headers $headers -Body $exportBody
Write-Host "Exported Package ID:" $pkg.manifest.packageId
Write-Host "Manifest SHA-256 Checksum:" $pkg.manifest.checksum
```

---

## 10. Day 19 — Tool Registry and Controlled Agent Loop Walkthrough

Nexus AI Day 19 establishes a typed, schema-validated tool registry, permission-aware execution, and a bounded controlled agent loop.

### 10.1 Automated Test Execution

Run the dedicated Day 19 test suite:
```powershell
cmd.exe /c "cd services\api && npx vitest run tests/day19-tool-registry-agent-loop.test.ts"
```
*Expected Output:* 27 / 27 tests pass (100%) covering registry initialization, dynamic tool lifecycle, strict schema argument validation, RBAC revalidation, cross-tenant isolation, iteration & tool call budgeting, per-tool timeouts, AbortSignal cancellation, PostgreSQL audit recording, credential sanitization, and REST API endpoints.

### 10.2 Manual Verification with PowerShell

#### Step 1: Discover Authorized Tools
Query available tools for the current user and workspace role:
```powershell
$tools = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/tools" -Method Get -Headers $headers
$tools.tools | Format-Table -Property name, displayName, requiredRole, enabled
```
*Expected Output:* Shows approved tools (`calculate`, `get_system_time`, `get_workspace_info`, `search_knowledge`, `inspect_service_status`).

#### Step 2: Execute Tool Proposal (Safe Calculator)
```powershell
$calcBody = @{
  toolName = "calculate"
  arguments = @{
    expression = "((12 + 8) * 5) / 2"
  }
} | ConvertTo-Json

$calcRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/tools/execute" -Method Post -Headers $headers -Body $calcBody
Write-Host "Execution Status:" $calcRes.result.status
Write-Host "Calculated Value:" $calcRes.result.output.result
```
*Expected Output:* Status `success` with result `50`.

#### Step 3: Verify Argument Validation Rejection
Confirm that extra unexpected fields or invalid parameters are rejected:
```powershell
try {
  $badArgs = @{
    toolName = "calculate"
    arguments = @{
      expression = "10 + 20"
      unauthorizedInjectedKey = "rm -rf /"
    }
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "http://localhost:4001/api/v1/tools/execute" -Method Post -Headers $headers -Body $badArgs
} catch {
  Write-Host "Rejected with HTTP code:" $_.Exception.Response.StatusCode.value__
}
```
*Expected Output:* HTTP `400 Bad Request` with `InvalidToolArguments`.

#### Step 4: Run Bounded Controlled Agent Loop
```powershell
$agentBody = @{
  query = "What is 6 multiplied by 7?"
  config = @{
    maxIterations = 3
    maxToolCalls = 2
  }
} | ConvertTo-Json

$agentRun = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/agent/run" -Method Post -Headers $headers -Body $agentBody
Write-Host "Stop Reason:" $agentRun.result.stopReason
Write-Host "Total Tool Calls:" $agentRun.result.totalToolCalls
Write-Host "Final Response:" $agentRun.result.finalResponse
```
*Expected Output:* Stop reason `completed`, tool calls `>= 1`, final response containing computed answer `42`.

#### Step 5: Query Tool Execution Audit Records
```powershell
$executions = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/tools/executions" -Method Get -Headers $headers
$executions.records | Format-Table -Property toolName, status, durationMs, createdAt
```
*Expected Output:* Shows detailed execution records with sanitized arguments.

---

## 11. Day 19 Verification Scorecard & Checklist

| # | Feature / Test Requirement | Verification Target | Expected Result | Status |
|---|---|---|---|:---:|
| 1 | **Centralized Tool Registry** | `ToolRegistry` Singleton | Pre-registered built-ins; rejects unregistered tools | ✅ Pass |
| 2 | **Dynamic Tool Registration** | `registerTool()` / `unregisterTool()` | Supports runtime extension with Zod schemas | ✅ Pass |
| 3 | **Input Argument Validation** | `validateToolProposal()` | Validates parameters, types, and bounds strictly | ✅ Pass |
| 4 | **Extra Fields Rejection** | Zod `.strict()` validation | Rejects unknown properties and payload tampering | ✅ Pass |
| 5 | **Safe Arithmetic Sandboxing** | `evaluateSafeMath()` | Shunting-yard arithmetic parser; zero `eval()` | ✅ Pass |
| 6 | **Output Contract Validation** | `validateToolResult()` | Guarantees outputs match declared outputSchema | ✅ Pass |
| 7 | **Role-Based Authorization** | `executeTool()` | Revalidates role; blocks viewer from analyst tools | ✅ Pass |
| 8 | **Cross-Tenant Boundary** | `executeTool()` | Context derived from server session; blocks foreign spaces | ✅ Pass |
| 9 | **Bounded Agent Loop** | `runControlledAgentLoop()` | Multi-turn reasoning with observations | ✅ Pass |
| 10 | **Iteration Limits** | `maxIterations` budget | Halts with `max_iterations_reached` without hanging | ✅ Pass |
| 11 | **Tool Call Limits** | `maxToolCalls` budget | Halts with `max_tool_calls_reached` | ✅ Pass |
| 12 | **Per-Tool Timeout** | `Promise.race` timeout | Aborts hanging operations with `timed_out` | ✅ Pass |
| 13 | **Cancellation Support** | `AbortSignal` propagation | Halts immediately with `cancelled` on abort | ✅ Pass |
| 14 | **Audit Logging Database** | `012_tool_registry_and_execution_records_day19.sql` | `tool_execution_records` table | ✅ Pass |
| 15 | **Credential Sanitization** | `sanitizeToolArguments()` | Masks passwords, apiKeys, tokens to `[REDACTED]` | ✅ Pass |
| 16 | **Proposal vs Execution** | Architecture decoupling | Model proposals are untrusted proposals, not code | ✅ Pass |
| 17 | **Tools Discovery API** | `GET /api/v1/tools` | Role-filtered catalog of authorized tools | ✅ Pass |
| 18 | **Tool Execution API** | `POST /api/v1/tools/execute` | Validates, authorizes, and executes proposals | ✅ Pass |
| 19 | **Audit Records API** | `GET /api/v1/tools/executions` | Paginated workspace tool execution history | ✅ Pass |
| 20 | **Agent Run API** | `POST /api/v1/agent/run` | Executes bounded multi-turn agent loop | ✅ Pass |
| 21 | **Day 19 Vitest Suite** | `day19-tool-registry-agent-loop.test.ts` | 27 / 27 unit & integration tests pass (100%) | ✅ Pass |
| 22 | **Phase 4 & 5 Regression** | Day 16, 17, 18, 19 Suites | 77 / 77 tests pass (100%) | ✅ Pass |
| 23 | **Parser Service Regression** | `pytest services/parser` | 40 / 40 pytest tests pass (100%) | ✅ Pass |

---

## 12. Day 20 — Universal Multi-Project Platform Dashboard & Protected RAG Regression

Nexus AI Day 20 elevates the platform into a responsive multi-project documentation AI dashboard while protecting all underlying Day 1–19 backend and RAG systems.

### 12.1 Automated Test Execution

Run the dedicated Day 20 test suite:
```powershell
cmd.exe /c "cd services\api && npx vitest run tests/day20-dashboard-rag-regression.test.ts"
```
*Expected Output:* 9 / 9 tests pass (100%) verifying workspace APIs, assistant/knowledge space project associations, protected hybrid RAG retrieval with verified citations, cross-project isolation, and widget asset serving.

Run the frontend dashboard build:
```powershell
cmd.exe /c "cd apps\widget-demo && npm run build"
```
*Expected Output:* Production bundle built with zero errors in ~1s.

---

## 13. Day 20 Verification Scorecard & Checklist

| # | Feature / Test Requirement | Verification Target | Expected Result | Status |
|---|---|---|---|:---:|
| 1 | **Multi-Project Navigation** | `apps/widget-demo/src/components/Navbar.tsx` | Dashboard, Projects, Knowledge Bases, Assistants, Widget Config, Playground, Showcases | ✅ Pass |
| 2 | **Responsive Layout** | Desktop, Tablet, Mobile Breakpoints | Collapsible menus, flexible cards, mobile drawer | ✅ Pass |
| 3 | **Real Workspace APIs** | `GET /api/v1/workspaces`, `POST /api/v1/workspaces` | Lists and creates real projects | ✅ Pass |
| 4 | **Project Details & Linking** | `GET /api/v1/workspaces/:id` | Associates projects with assistants & knowledge spaces | ✅ Pass |
| 5 | **Cross-Tenant Boundary** | Permission Checks | Strict workspace-level isolation; blocks cross-project tampering | ✅ Pass |
| 6 | **Widget Embed Studio** | Visual Customizer & Code Generator | Script tag and React component snippets with live copy feedback | ✅ Pass |
| 7 | **Testing Playground** | Interactive Live Testing | Mounted `@nomaanos/nexus-widget` with live backend connection | ✅ Pass |
| 8 | **Preserved Showcases** | `ShowcasesView.tsx` | Sentinel SOC, Developer Docs, and Cloud Operations 100% intact | ✅ Pass |
| 9 | **Protected RAG Pipeline** | `POST /conversations/:id/messages` | Hybrid search, evidence assembly, and real verified citations intact | ✅ Pass |
| 10 | **Local Widget Delivery** | `/widget/nexus-widget.umd.js` & `/widget/style.css` | Zero external CDN links; 100% air-gap compliant | ✅ Pass |
| 11 | **Monorepo Build Integrity** | `npm run build` | All packages and applications build with zero TypeScript errors | ✅ Pass |
| 12 | **Day 20 Test Suite** | `day20-dashboard-rag-regression.test.ts` | 9 / 9 unit and integration tests pass (100%) | ✅ Pass |




