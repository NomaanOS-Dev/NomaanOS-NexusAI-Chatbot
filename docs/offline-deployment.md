# Disconnected & Private Air-Gapped Deployment Guide
**NomaanOS Nexus AI — Day 18 Architecture & Operations**

This guide provides engineering standards, model pre-staging instructions, knowledge package transfer protocols, and feature compatibility matrices for deploying Nexus AI in 100% disconnected, air-gapped, or classified private network environments.

---

## 1. Architectural Overview & Disconnected Principles

In an air-gapped deployment, Nexus AI operates with **zero external network egress**:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    AIR-GAPPED PRIVATE ENCLAVE                          │
 │                                                                        │
 │   [ Browser User / Client ]                                            │
 │         │                                                              │
 │         ▼ (Local Network / Intranet HTTP)                              │
 │   [ Self-Hosted Widget Bundle ]                                        │
 │   (Served from /widget/nexus-widget.umd.js - No CDN / System Fonts)    │
 │         │                                                              │
 │         ▼                                                              │
 │   [ Nexus AI API Server (Port 4001) ] ◄── OFFLINE_MODE=true            │
 │     ├── Full-Text Search (PostgreSQL tsearch2)                         │
 │     ├── Semantic Vector Search (PostgreSQL pgvector)                   │
 │     ├── Document Parsers (Python pdfplumber, bs4, markdown)            │
 │     ├── Local Embeddings (MiniLM-L6-v2 via TRANSFORMERS_OFFLINE=1)     │
 │     ├── Local Reranker (ms-marco-MiniLM-L-6-v2 via local_files_only)   │
 │     └── Local LLM Inference (Ollama daemon on localhost:11434)         │
 │                                                                        │
 │   [ Offline Package Transfer Service ]                                 │
 │   (SHA-256 Verified Sneaker-Net / Data-Diode Knowledge Ingestion)       │
 └────────────────────────────────────────────────────────────────────────┘
```

### Invariant Rules for Disconnected Operation
1. **Zero Outbound Telemetry**: No telemetry, analytics, fonts, scripts, or cloud inference calls leave the host machine.
2. **Local Self-Containment**: The frontend chat widget, HTML assets, vector database, embeddings, parsers, and language models are stored on local storage volumes.
3. **Deterministic Fallback**: If an offline component is temporarily overloaded, requests fall back strictly to local deterministic generation—never silently attempting to contact external endpoints.

---

## 2. Hardware Sizing & Offline Model Requirements

| Component | Default Model / Resource | Minimum Allocation | Air-Gapped Cache Path |
|---|---|---|---|
| **Local LLM** | `llama3.1:8b` or `qwen3.8:27b` | 16GB RAM (8B) / 32GB RAM (27B) | `~/.ollama/models/blobs/` |
| **Embeddings** | `sentence-transformers/all-MiniLM-L6-v2` | 2 CPU Cores / 1GB RAM | `~/.cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2/` |
| **Reranker** | `cross-encoder/ms-marco-MiniLM-L-6-v2` | 2 CPU Cores / 1GB RAM | `~/.cache/huggingface/hub/models--cross-encoder--ms-marco-MiniLM-L-6-v2/` |
| **Database** | PostgreSQL 16 + pgvector | 4GB RAM, NVMe SSD recommended | `/var/lib/postgresql/data` |
| **Widget UI** | Pre-bundled UMD (`nexus-widget.umd.js`) | ~160KB disk | `packages/widget/dist/` |

---

## 3. Offline Pre-Staging Procedure (Before Air-Gap Transfer)

Follow these steps on an internet-connected staging machine to prepare assets prior to transferring into the private environment:

### Step 3.1: Pre-Pull Ollama Language Models
```bash
# Pull production model
ollama pull llama3.1:8b

# Export Ollama model blobs
tar -czvf ollama-models.tar.gz -C ~/.ollama/models .
```

### Step 3.2: Pre-Cache Python Embedding and Reranker Weights
```bash
python -c "
from sentence_transformers import SentenceTransformer, CrossEncoder
print('Downloading MiniLM embedding model...')
SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
print('Downloading CrossEncoder reranker...')
CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
print('Models cached successfully.')
"

# Archive Hugging Face hub cache
tar -czvf huggingface-cache.tar.gz -C ~/.cache/huggingface/hub .
```

### Step 3.3: Pre-Build Frontend Widget & NPM Dependencies
```bash
# Build standalone widget bundle without external font/CDN references
npm run build
```

---

## 4. Air-Gapped Environment Configuration

Deploy assets inside the isolated environment and configure `services/api/.env`:

```ini
# =============================================================================
# Day 18: Disconnected & Offline Operational Settings
# =============================================================================
OFFLINE_MODE=true
REMOTE_DATA_ENABLED=false
LOCAL_INFERENCE_ONLY=true
MODEL_ROUTING_POLICY=local-only
OFFLINE_STORAGE_DIR=storage/offline_packages

# HuggingFace & Sentence-Transformers Offline Enforcement
TRANSFORMERS_OFFLINE=1
HF_HUB_OFFLINE=1
NEXUS_OFFLINE_MODE=true

# Local Ollama Inference
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT_MS=60000
```

---

## 5. Offline Knowledge Package Transfer Protocol (Sneaker-Net / Data Diode)

Because automated cloud sync (e.g. Google Drive, Confluence Cloud) cannot function without internet access, knowledge is ingested via **Cryptographically Verified Offline Packages** (`.nexus-pack.json`).

```
[ Connected Staging System ]
           │
           ▼
[ POST /api/v1/offline/export ]
           │
           ▼
[ .nexus-pack.json ] ──► (SHA-256 Checksum Computed)
           │
           ▼ (Approved Optical Media / Flash Drive / Data Diode)
           │
[ Air-Gapped Nexus AI Enclave ]
           │
           ▼
[ POST /api/v1/offline/import ]
           │
           ├── 1. SHA-256 Hash Verification against Manifest
           │      (Tampered / corrupted packages rejected immediately)
           ├── 2. Atomic PostgreSQL Transaction
           └── 3. Instant Availability for Full-Text & Semantic Retrieval
```

### Exporting Knowledge from Staging
```bash
curl -X POST http://localhost:4001/api/v1/offline/export \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"knowledgeSpaceId": "<SPACE_UUID>", "saveToDisk": true}'
```

### Importing Knowledge into Air-Gapped Production
```bash
curl -X POST http://localhost:4001/api/v1/offline/import \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "package": <PACKAGE_JSON>,
    "targetSpaceName": "Classified Operations Manual"
  }'
```

---

## 6. Feature Compatibility Matrix: Disconnected vs. Connected

| Platform Capability | Disconnected / Air-Gapped Mode | Connected Cloud Mode | Notes |
|---|:---:|:---:|---|
| **Grounded Question Answering (RAG)** | ✅ **Fully Supported** | ✅ Fully Supported | Operates using locally indexed PostgreSQL chunks |
| **Hybrid Search (Keyword + Semantic)** | ✅ **Fully Supported** | ✅ Fully Supported | Local pgvector (MiniLM) + PostgreSQL tsearch2 |
| **Reranking** | ✅ **Fully Supported** | ✅ Fully Supported | In-process CrossEncoder cached locally |
| **Document Parsers (PDF, MD, HTML, JSON)** | ✅ **Fully Supported** | ✅ Fully Supported | Python in-process libraries (pdfplumber, bs4) |
| **Conversation Context & Memory** | ✅ **Fully Supported** | ✅ Fully Supported | PostgreSQL conversation history & summaries |
| **Self-Hosted Embedded Chat Widget** | ✅ **Fully Supported** | ✅ Fully Supported | Bundled UMD served from local `/widget` route |
| **Local LLM Inference (Ollama)** | ✅ **Fully Supported** | ✅ Fully Supported | Executes on local GPU or CPU via llama.cpp |
| **Cloud LLMs (OpenAI, Anthropic)** | ❌ **Strictly Forbidden** | ✅ Optional | Blocked with HTTP 403 under `local-only` policy |
| **Live Remote Data / Web Telemetry** | ❌ **Unavailable** | ⚠️ Connectors | Gracefully displays offline mode notification |
| **Automated Cloud Sync (Google Drive)** | ❌ **Unavailable** | ⚠️ Background Sync | Replaced by offline `.nexus-pack` import protocol |

---

## 7. Handling Live Remote Data in Disconnected Mode

When a user inquires about real-time external data (e.g. live internet status, current weather, stock quotes):
- Day 11 query classification identifies the intent as `live_data`.
- The assistant delivers a clear, standardized offline disclosure:
  > *"Live remote data is unavailable in offline / air-gapped deployment mode. This Nexus AI instance operates strictly in a disconnected local environment with zero external connectivity. Responses are generated exclusively from authorized local knowledge sources."*

---

## 8. Disconnected Verification Runbook

To verify complete offline operation on the target machine:

```powershell
# 1. Disable host network adapters
Disable-NetAdapter -Name "Ethernet", "Wi-Fi" -Confirm:$false

# 2. Check offline readiness endpoint
Invoke-RestMethod -Uri "http://localhost:4001/api/v1/offline/status" -Method Get

# 3. Test chat generation via local widget at http://localhost:3000
# Expected: Grounded response generated with citations and zero network errors.

# 4. Re-enable network adapters after testing
Enable-NetAdapter -Name "Ethernet", "Wi-Fi" -Confirm:$false
```

