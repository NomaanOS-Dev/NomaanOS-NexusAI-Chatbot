# NomaanOS Nexus AI — Phase 2 Visual & Manual Testing Guide
**Document Version:** 1.0.0  
**Phase Coverage:** Days 6 through 12 (Knowledge Ingestion, Chunking, Background Sync, Local Embeddings, Hybrid Search, Query Understanding, Reranking & Retrieval Evaluation)  
**Target Environments:** Local Development (`http://localhost:5173` & `http://localhost:4001`)

---

## 1. Overview & Objective

This manual testing guide enables you to verify the entire **Phase 2 Knowledge & Retrieval Pipeline** of NomaanOS Nexus AI. 

### Phase 2 Architecture Capabilities Verified:
1. **Day 6 — Secure Document Upload & Extraction Pipeline**: Multi-format parsing (`.txt`, `.md`, `.html`, `.json`, `.yaml`), mime-type validation, sanitization against path traversal, and duplicate SHA-256 detection.
2. **Day 7 — Structure-Aware Chunking, Metadata & Versioning**: Heading/paragraph-aware chunking, token counting, content hash deduplication, atomic version supersession (Version 1 superseded by Version 2), and `activeOnly` isolation.
3. **Day 8 — Background Ingestion & Resilient Sync**: Asynchronous ingestion queue, idempotent job dispatch, exponential backoff retries, and dead-letter failure isolation.
4. **Day 9 — Local Embeddings & Vector Retrieval**: 100% offline local embedding generation using `sentence-transformers/all-MiniLM-L6-v2` daemon, PostgreSQL pgvector storage, and cosine distance search.
5. **Day 10 — Keyword Search & Hybrid Retrieval**: PostgreSQL full-text search with `tsvector`/`websearch_to_tsquery` matching exact technical error codes, API endpoints, and Reciprocal Rank Fusion (RRF) merging.
6. **Day 11 — Query Understanding & Adaptive Retrieval**: Deterministic and model classification across 7 intents, query rewriting, domain expansion, multi-part decomposition, and adaptive bounded retry search.
7. **Day 12 — Cross-Encoder Reranking & Retrieval Evaluation**: Configurable cross-encoder (`cross-encoder/ms-marco-MiniLM-L-6-v2`) and heuristic reranking, mathematical IR benchmark metrics (Recall@K, Precision@K, MRR, nDCG@K), and tenant boundary access-control evaluation.

---

## 2. Pre-Flight Setup & Environment Verification

Open two terminal windows in the project root: `D:\Projects\8-NomaanOS-Nexus-AI`.

### Step 2.1: Verify PostgreSQL & pgvector Database
Ensure the PostgreSQL 16 container with the `vector` extension is running:
```powershell
npm.cmd run db:up
```
*Expected Output:* Container `nomaanos-nexus-database` is started on port `5434`.

### Step 2.2: Apply Migrations & Verify Schema
Ensure all Day 1–12 database migrations are up to date:
```powershell
npm.cmd run db:migrate
```
*Expected Output:* `Migration execution completed successfully.`

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

Verify backend health:
- `http://localhost:4001/health` ➔ `{"status":"ok","timestamp":"..."}`
- `http://localhost:4001/ready` ➔ `{"status":"ready","database":"connected"}`

### Step 2.4: Start the Widget Showcase Demo
In **Terminal 2**, run:
```powershell
npm.cmd run dev --workspace=apps/widget-demo
```
*Expected Output:* Vite dev server running at `http://localhost:5173`.

---

## 3. Phase 2 End-to-End Walkthrough

You will register an administrative evaluation user, create an isolated knowledge space, upload multi-format technical documents, inspect structure-aware chunks, perform semantic and hybrid search, execute query understanding, apply cross-encoder reranking, and run retrieval evaluation benchmarks.

### Phase 2 Initialization Script (PowerShell)
Copy and paste this snippet into a new PowerShell terminal to set up your test credentials:

```powershell
# 1. Register Phase 2 QA Admin
$regResponse = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
    email = "phase2-evaluator@nexus-ai.io";
    password = "Phase2SecurePassword123!";
    fullName = "Phase 2 Evaluation Lead";
    organizationName = "Evaluation Research Labs"
  } | ConvertTo-Json)

$TOKEN = $regResponse.token
$WORKSPACE_ID = $regResponse.workspace.id

# 2. Create Active Knowledge Space
$spaceResponse = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    name = "Nexus SRE Knowledge Base";
    slug = "nexus-sre-kb";
    description = "Core runbooks, error codes, and microservice infrastructure docs."
  } | ConvertTo-Json)

$SPACE_ID = $spaceResponse.knowledgeSpace.id

Write-Host "=========================================" -ForegroundColor Green
Write-Host "Phase 2 Test Environment Initialized:" -ForegroundColor Cyan
Write-Host "Workspace ID: $WORKSPACE_ID"
Write-Host "Knowledge Space ID: $SPACE_ID"
Write-Host "Auth Token: $TOKEN"
Write-Host "=========================================" -ForegroundColor Green
```

---

### Scenario 1: Document Upload, Extraction & Chunking (Days 6 & 7)
**Objective:** Verify that unstructured documents are extracted, chunked with section hierarchy, hashed for deduplication, and persisted into versioned knowledge records.

#### Step 1.1: Upload Technical Markdown Document (Version 1)
```powershell
$docContent = @"
# Sentinel SRE Runbook

## Cluster Topology & Networking
The Kafka broker is reachable at kafka-broker-01.internal on port 9092.
Host node-prod-42 operates as the primary ingress revalidation proxy.
If elevated latencies occur on node-prod-42, initiate failover to node-prod-43.

## Critical Error Codes
Error code ERR_NEXUS_CONN_REFUSED indicates that the upstream gRPC broker refused connection on port 9443 due to exhausted worker pool.
When client tokens expire after the 15-minute TTL, the auth service returns ERR_AUTH_EXPIRED.

## Authentication Protocols
Endpoint POST /api/v1/auth/tokens/revoke terminates an active bearer session.
For federated access, OAuth 2.1 with mTLS mutual authentication is strictly enforced.
"@

# Write temporary file
Set-Content -Path "sre-runbook.md" -Value $docContent

# Upload via curl / multipart form
$uploadRes = curl.exe -s -X POST "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/sources" `
  -H "Authorization: Bearer $TOKEN" `
  -F "title=Sentinel SRE Runbook" `
  -F "file=@sre-runbook.md" | ConvertFrom-Json

$SOURCE_ID = $uploadRes.source.id
$VERSION_1_ID = $uploadRes.source.versionId

Write-Host "Uploaded Source ID: $SOURCE_ID" -ForegroundColor Cyan
Write-Host "Version 1 ID: $VERSION_1_ID" -ForegroundColor Cyan
Write-Host "Generated Chunk Count: $($uploadRes.source.chunkCount)" -ForegroundColor Green
```

#### Step 1.2: Inspect Structure-Aware Chunks & Metadata
Retrieve the persisted chunks to inspect provenance and token counts:
```powershell
$chunksRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/knowledge-sources/$SOURCE_ID/chunks" `
  -Headers @{ Authorization = "Bearer $TOKEN" }

$chunksRes.chunks | ForEach-Object {
  Write-Host "-------------------------------------------"
  Write-Host "Chunk ID: $($_.id)" -ForegroundColor Yellow
  Write-Host "Section: $($_.sectionPath)" -ForegroundColor Cyan
  Write-Host "Tokens: $($_.tokenCount)"
  Write-Host "Excerpt: $($_.content.Substring(0, [Math]::Min(80, $_.content.Length)))..."
}
```
*Verification Check:* Every chunk has a non-null `sectionPath` and `tokenCount`.

#### Step 1.3: Incremental Document Update & Atomic Supersession (Version 2)
Update the document with modified content:
```powershell
$docContentV2 = @"
# Sentinel SRE Runbook (v2)

## Cluster Topology & Networking
The Kafka broker is reachable at kafka-broker-01.internal on port 9092.
Host node-prod-42 operates as the primary ingress proxy with node-prod-43 as warm standby.

## Critical Error Codes
Error code ERR_NEXUS_CONN_REFUSED indicates that gRPC broker connection dropped on port 9443.
Mitigation: Execute 'nexusctl pool expand --workers=64'.
"@

Set-Content -Path "sre-runbook-v2.md" -Value $docContentV2

$updateRes = curl.exe -s -X PUT "http://localhost:4001/api/v1/knowledge-sources/$SOURCE_ID" `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@sre-runbook-v2.md" | ConvertFrom-Json

$VERSION_2_ID = $updateRes.update.versionId
Write-Host "Version 2 ID: $VERSION_2_ID" -ForegroundColor Green
```

#### Step 1.4: Verify Superseded Version Isolation
Query chunks with `activeOnly=true`:
```powershell
$activeChunks = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/knowledge-sources/$SOURCE_ID/chunks?activeOnly=true" `
  -Headers @{ Authorization = "Bearer $TOKEN" }

Write-Host "Active Chunks Count: $($activeChunks.chunks.Count)" -ForegroundColor Green
$allBelongToV2 = ($activeChunks.chunks | Where-Object { $_.versionId -ne $VERSION_2_ID }).Count -eq 0
Write-Host "All Active Chunks Belong to Version 2: $allBelongToV2" -ForegroundColor Green
```
*Verification Check:* `All Active Chunks Belong to Version 2: True`. Version 1 chunks are completely superseded.

---

### Scenario 2: Local Vector & Keyword Hybrid Search (Days 9 & 10)
**Objective:** Verify that PostgreSQL `pgvector` semantic retrieval and `tsvector` full-text search are merged using Reciprocal Rank Fusion (RRF).

#### Step 2.1: Semantic Vector Search
```powershell
$semanticRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/search" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "How to expand gRPC worker pool after connection refusal?";
    searchMode = "semantic";
    topK = 3
  } | ConvertTo-Json)

Write-Host "Semantic Search Results: $($semanticRes.results.Count)" -ForegroundColor Green
Write-Host "Top Semantic Similarity: $($semanticRes.results[0].similarityScore)" -ForegroundColor Cyan
```

#### Step 2.2: Exact Technical Keyword Search
Search for an exact error code token:
```powershell
$keywordRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/search" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "ERR_NEXUS_CONN_REFUSED";
    searchMode = "keyword";
    topK = 3
  } | ConvertTo-Json)

Write-Host "Keyword Hits: $($keywordRes.results.Count)" -ForegroundColor Green
Write-Host "Top Chunk Content: $($keywordRes.results[0].content)" -ForegroundColor Yellow
```

#### Step 2.3: Hybrid RRF Search
Execute combined hybrid retrieval:
```powershell
$hybridRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/search" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "ERR_NEXUS_CONN_REFUSED port 9443";
    searchMode = "hybrid";
    rrfK = 60;
    topK = 3
  } | ConvertTo-Json)

Write-Host "Hybrid RRF Score: $($hybridRes.results[0].rrfScore)" -ForegroundColor Green
Write-Host "RRF Rank: $($hybridRes.results[0].rankings.rrfRank)" -ForegroundColor Cyan
Write-Host "Semantic Rank: $($hybridRes.results[0].rankings.semanticRank)" -ForegroundColor Cyan
Write-Host "Keyword Rank: $($hybridRes.results[0].rankings.keywordRank)" -ForegroundColor Cyan
```

---

### Scenario 3: Query Understanding & Adaptive Retrieval (Day 11)
**Objective:** Verify automatic query classification, conversational rewriting, sub-query decomposition, and adaptive bounded retry search.

#### Step 3.1: Query Understanding Analysis
Inspect the classifier across different query intents:
```powershell
$quRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/knowledge-spaces/$SPACE_ID/query-understanding" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "How do I configure OAuth with mTLS and what host operates as the ingress proxy?"
  } | ConvertTo-Json)

Write-Host "Intent Category: $($quRes.classification.category)" -ForegroundColor Green
Write-Host "Is Multi-Part: $($quRes.classification.isMultiPart)" -ForegroundColor Cyan
Write-Host "Decomposed Sub-Queries:" -ForegroundColor Yellow
$quRes.decomposition.subQueries | ForEach-Object { Write-Host " - $_" }
```

#### Step 3.2: Adaptive Retrieval with Intent Routing
Test adaptive retrieval which merges sub-queries automatically:
```powershell
$adaptiveRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/knowledge-spaces/$SPACE_ID/adaptive-search" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "How do I configure OAuth with mTLS and what host operates as the ingress proxy?";
    topK = 5
  } | ConvertTo-Json)

Write-Host "Adaptive Execution Mode: $($adaptiveRes.adaptivePlan.executionMode)" -ForegroundColor Green
Write-Host "Total Retrieved Chunks: $($adaptiveRes.results.Count)" -ForegroundColor Cyan
```

---

### Scenario 4: Cross-Encoder Reranking (Day 12)
**Objective:** Verify that cross-encoder reranking re-evaluates candidate chunks, boosting exact technical tokens to Rank 1 while strictly preserving chunk provenance and metadata.

#### Step 4.1: Direct Candidate Reranking Endpoint
Pass a list of candidate chunks with an exact technical error code:
```powershell
$rerankRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/knowledge-spaces/$SPACE_ID/rerank" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "ERR_NEXUS_CONN_REFUSED on port 9443";
    strategy = "heuristic";
    candidates = @(
      @{
        id = "c-networking";
        content = "General TCP buffer and proxy configuration guide.";
        score = 0.030
      },
      @{
        id = "c-error-exact";
        content = "Critical: Error code ERR_NEXUS_CONN_REFUSED indicates upstream broker connection dropped on port 9443.";
        score = 0.015
      }
    )
  } | ConvertTo-Json)

Write-Host "Promoted Top Chunk ID: $($rerankRes.results[0].chunkId)" -ForegroundColor Green
Write-Host "Top Chunk Rerank Score: $($rerankRes.results[0].rerankScore)" -ForegroundColor Cyan
Write-Host "Latency: $($rerankRes.timingMs)ms" -ForegroundColor Yellow
```
*Verification Check:* Candidate `c-error-exact` is promoted to Rank 1 over `c-networking` despite starting with a lower RRF score.

#### Step 4.2: Integrated Hybrid Search with Reranking
Execute search with `rerank = true`:
```powershell
$searchWithRerank = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/search" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    query = "ERR_NEXUS_CONN_REFUSED worker pool expand";
    searchMode = "hybrid";
    rerank = $true;
    topK = 3
  } | ConvertTo-Json)

Write-Host "Rerank Applied: $($searchWithRerank.rerankApplied)" -ForegroundColor Green
Write-Host "Rerank Model: $($searchWithRerank.reranker.modelId)" -ForegroundColor Cyan
Write-Host "Rerank Strategy: $($searchWithRerank.reranker.strategy)" -ForegroundColor Cyan
Write-Host "Rerank Timing: $($searchWithRerank.timingsMs.rerank)ms" -ForegroundColor Yellow
```

---

### Scenario 5: Retrieval Evaluation Benchmarking (Day 12)
**Objective:** Run the standardized evaluation dataset over the knowledge space to calculate Recall@K, Precision@K, MRR, nDCG@K, delta improvements, and verify zero cross-tenant leakage.

#### Step 5.1: Execute Evaluation Benchmark Run
```powershell
$evalReport = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID/knowledge-spaces/$SPACE_ID/evaluation/run" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    strategy = "heuristic";
    kValues = @(5)
  } | ConvertTo-Json)

Write-Host "=========================================" -ForegroundColor Green
Write-Host "RETRIEVAL EVALUATION REPORT" -ForegroundColor Cyan
Write-Host "Dataset Version: $($evalReport.datasetVersion)"
Write-Host "Total Queries Evaluated: $($evalReport.queryCount)"
Write-Host "K Cutoff: $($evalReport.k)"
Write-Host "-----------------------------------------"
Write-Host "Baseline MRR:      $($evalReport.baseline.meanMRR)"
Write-Host "Reranked MRR:      $($evalReport.reranked.meanMRR)"
Write-Host "MRR Delta:         $($evalReport.deltas.mrrDelta)" -ForegroundColor Green
Write-Host "Baseline nDCG@K:   $($evalReport.baseline.meanNDCGAtK)"
Write-Host "Reranked nDCG@K:   $($evalReport.reranked.meanNDCGAtK)"
Write-Host "nDCG Delta:        $($evalReport.deltas.ndcgDelta)" -ForegroundColor Green
Write-Host "-----------------------------------------"
Write-Host "ACCESS CONTROL EVALUATION:" -ForegroundColor Yellow
Write-Host "Cross-Tenant Leaked Chunks: $($evalReport.accessControl.crossTenantLeakedChunks)"
Write-Host "Superseded Chunks Leaked:   $($evalReport.accessControl.supersededChunksLeaked)"
Write-Host "Security Correctness:       $($evalReport.accessControl.authorizationCorrectnessPercent)%"
Write-Host "=========================================" -ForegroundColor Green
```
*Verification Check:* 
1. `MRR Delta` and `nDCG Delta` are $\ge 0.0$ (retrieval quality equal or improved).
2. `Cross-Tenant Leaked Chunks: 0`.
3. `Superseded Chunks Leaked: 0`.
4. `Security Correctness: 100%`.

---

### Scenario 6: Visual Showcase Widget Integration (Browser)
**Objective:** Verify that knowledge retrieved via the Day 6–13 pipeline appears seamlessly grounded in the web chat widget.

1. Open **`http://localhost:3000`** in your browser.
2. Select the **🛡️ Sentinel SOC** host application.
3. Open the chat widget by clicking the bottom-right launcher button.
4. Select any displayed suggested question pill or type a question:
   - **Option A (Suggested Prompt Pill):** Click *"Analyze threat telemetry for anomaly alert #9021"* (or *"Explain recent brute-force attempts on SSH port 22"*).
   - **Option B (Typed Technical Question):**
     ```text
     What mitigation steps should I take if ERR_NEXUS_CONN_REFUSED occurs?
     ```
5. **Observe Visual Elements:**
   - **Tool Status Pill:** Appears showing `knowledge_retrieval: completed` with glowing animation.
   - **Streaming Response:** Text streams into chat token-by-token explaining the incident findings and grounded facts.
   - **Citation Badge:** Click the citation pill (e.g. `[1] Sentinel Incident Response Playbook v4.2`).
   - **Citation Drawer:** Slides open revealing excerpt, document version (`v1` / `v2`), and relevance match score.

---

## 4. Phase 2 Verification Scorecard

| Scenario / Feature | Test Type | Acceptance Criteria | Result |
| :--- | :--- | :--- | :---: |
| **Document Upload & Parsing** (Day 6) | Integration / API | Multipart upload, Markdown AST extraction, SHA-256 hash | PASS |
| **Structure-Aware Chunking** (Day 7) | Database / API | Section path hierarchy, token count, content hashing | PASS |
| **Version Supersession** (Day 7) | API / Access | Version 1 superseded by Version 2; zero V1 chunks on `activeOnly=true` | PASS |
| **Background Ingestion & Sync** (Day 8) | Asynchronous Queue | Durable job queue, retry on error, dead-letter recording | PASS |
| **Local Vector Search** (Day 9) | Database / pgvector | Offline embeddings, cosine distance ranking, HNSW indexing | PASS |
| **Keyword & Hybrid Search** (Day 10) | Full-Text / RRF | Exact token match, `tsvector` index, Reciprocal Rank Fusion | PASS |
| **Query Understanding** (Day 11) | Heuristic & Router | Intent classification, conversational rewrite, sub-query decomposition | PASS |
| **Configurable Reranking** (Day 12) | Cross-Encoder / Fallback | Exact token promotion to Rank 1, metadata preservation | PASS |
| **Retrieval Evaluation Metrics** (Day 12) | Math IR Engine | Recall@K, Precision@K, MRR, nDCG@K calculated accurately | PASS |
| **Access-Control Evaluation** (Day 12) | Security / Isolation | 0 cross-tenant leaks, 0 superseded chunks, 100% security correctness | PASS |
| **Visual Widget Citations** (Day 12) | Browser UI | Grounded tool pill, streamed text, interactive versioned citation drawer | PASS |

---

## 5. Cleanup Script (Optional)

To delete the test workspace and test user after completing the manual walkthrough:
```powershell
$cleanupRes = Invoke-RestMethod -Uri "http://localhost:4001/api/v1/workspaces/$WORKSPACE_ID" `
  -Method Delete `
  -Headers @{ Authorization = "Bearer $TOKEN" }

Write-Host "Cleanup Completed: $($cleanupRes.status)" -ForegroundColor Yellow
Remove-Item -Path "sre-runbook.md", "sre-runbook-v2.md" -ErrorAction SilentlyContinue
```

