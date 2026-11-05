# Local Model Inference & Offline Deployment Guide
**NomaanOS Nexus AI — Day 16 Operations Architecture**

This guide provides operational standards, hardware sizing guidelines, model pulling instructions, and troubleshooting procedures for running Nexus AI fully locally using **Ollama** and local vector embeddings.

---

## 1. Architectural Overview

Nexus AI supports completely offline, air-gapped local model inference via its provider-independent interface:

```
[ User / Chat Widget ]
         │
         ▼
[ Nexus AI API Server (Port 4001) ]
   ├── RAG Evidence Assembly & Claim Verification (Days 9–14)
   ├── Bounded Context & Memory Management (Day 15)
   └── Inference Adapter Layer (Day 16)
         │
         ├── Provider: 'ollama' ──► http://127.0.0.1:11434 (Local Ollama Engine)
         └── Provider: 'local_deterministic' ──► In-Process Fallback Engine
```

### Zero Cloud Inference Policy
When `LOCAL_INFERENCE_ONLY=true` is configured in the environment:
- Requests attempting to route to cloud providers (e.g. OpenAI, Anthropic) are strictly rejected with an HTTP 403 Forbidden error.
- All generative tasks, grounded Q&A, and structured JSON outputs run via local inference or deterministic fallback.
- No outbound internet telemetry or prompts are transmitted outside the host machine.

---

## 2. Hardware Sizing & Recommended Models

Local inference speed and reliability depend on CPU cores, system RAM, GPU VRAM, and storage bus speed (NVMe recommended).

| Model Class | Recommended Model | Minimum RAM | Recommended VRAM | Typical Speed (Tokens/s) | Target Use Case |
|---|---|---|---|---|---|
| **Compact (1B – 3B)** | `llama3.2:1b`, `llama3.2:3b` | 8 GB | 4 GB VRAM (or CPU) | 40 – 70 t/s | Lightweight edge instances, quick replies, test suites |
| **Standard (7B – 8B)** | `mistral:7b-instruct`, `llama3.1:8b` | 16 GB | 8 GB VRAM | 25 – 45 t/s | Default production standard for enterprise grounded answers |
| **Mid-Heavy (13B – 14B)** | `qwen2.5:14b`, `phi4:14b` | 24 GB | 12 GB – 16 GB VRAM | 18 – 30 t/s | Complex reasoning, multi-language, technical query routing |
| **Enterprise Heavy (27B+)** | `qwen3.8:27b`, `command-r:35b` | 32 GB – 64 GB | 16 GB – 24 GB VRAM | 10 – 20 t/s | Deep security triage, structured telemetry parsing, high-detail synthesis |

> [!NOTE]
> For CPU-only deployments (without NVIDIA CUDA or Apple Metal), quantized models (`Q4_K_M`) are strongly recommended. Set `OLLAMA_TIMEOUT_MS=120000` to allow sufficient time for token generation on large prompts.

---

## 3. Ollama Installation & Setup

### Windows Installation
1. Download the installer from [https://ollama.com/download/windows](https://ollama.com/download/windows) or run via winget:
   ```powershell
   winget install Ollama.Ollama
   ```
2. Verify Ollama service is active:
   ```powershell
   curl http://127.0.0.1:11434/api/tags
   ```

### Linux Installation (Ubuntu / Debian / RHEL)
1. Install with standard curl script:
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```
2. Check systemd service status:
   ```bash
   sudo systemctl status ollama
   ```

### Pulling Recommended Models
Pull your desired model before going offline:
```bash
# Recommended default for balanced speed and accuracy
ollama pull llama3.1:8b

# Or lightweight for rapid testing
ollama pull llama3.2:3b

# Or enterprise heavy
ollama pull qwen3.8:27b
```

---

## 4. Nexus AI Configuration

Configure local inference settings in `services/api/.env`:

```ini
# =============================================================================
# Day 16: Local Model Inference Configuration
# =============================================================================
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT_MS=60000
OLLAMA_KEEP_ALIVE=5m
OLLAMA_TEMPERATURE=0.2
LOCAL_INFERENCE_ONLY=true
```

### Parameter Reference
- `INFERENCE_PROVIDER`: Set to `ollama` (for active local LLM) or `local_deterministic` (for offline deterministic synthesis without LLM).
- `OLLAMA_BASE_URL`: HTTP endpoint of the local Ollama daemon (defaults to `http://127.0.0.1:11434`).
- `OLLAMA_MODEL`: Tag name of the model installed in Ollama.
- `OLLAMA_TIMEOUT_MS`: Maximum duration in milliseconds before an inference call aborts (default `60000`).
- `OLLAMA_KEEP_ALIVE`: How long the model remains loaded in memory/VRAM between requests (default `5m`).
- `OLLAMA_TEMPERATURE`: Sampling temperature (recommended `0.1`–`0.3` for grounded RAG).
- `LOCAL_INFERENCE_ONLY`: Enforces local-only execution policy; prevents any fallback or outbound call to external cloud APIs.

---

## 5. Air-Gapped / Offline Verification

To verify that Nexus AI operates fully offline without an internet connection:

1. **Disconnect Network / Disable Adapter**:
   ```powershell
   # Disable network adapter temporarily for testing
   Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false
   ```
2. **Verify Model Availability**:
   ```bash
   curl http://127.0.0.1:4001/api/v1/inference/health
   ```
   Expected response:
   ```json
   {
     "status": "healthy",
     "provider": "ollama",
     "localOnly": true,
     "activeModel": "llama3.1:8b",
     "modelsAvailable": ["llama3.1:8b"],
     "details": {
       "baseUrl": "http://127.0.0.1:11434",
       "keepAlive": "5m",
       "timeoutMs": 60000
     }
   }
   ```
3. **Send a Grounded Message**:
   Interact with the chat widget at `http://localhost:3000` or send a curl request:
   ```bash
   curl -X POST http://127.0.0.1:4001/api/v1/conversations/<CONVERSATION_ID>/messages \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <TOKEN>" \
     -d '{"content": "Summarize the security policy", "stream": false}'
   ```
   The response generates purely from local evidence chunks and local Ollama inference without outbound network activity.

---

## 6. Troubleshooting & Operational Runbook

### Issue 1: Ollama Connection Refused (`ECONNREFUSED 127.0.0.1:11434`)
- **Cause**: Ollama service is not running or running on a different port.
- **Resolution**:
  - Run `ollama serve` in a terminal or restart the Ollama background tray app.
  - Verify that `http://127.0.0.1:11434/api/tags` returns HTTP 200.

### Issue 2: Model Not Found (`Ollama model "<model>" is not available`)
- **Cause**: The model specified in `OLLAMA_MODEL` has not been pulled.
- **Resolution**:
  - Run `ollama list` to inspect installed models.
  - Run `ollama pull <model>` or adjust `OLLAMA_MODEL` in `.env` to match an installed model.

### Issue 3: Inference Timeout (`Ollama request timed out after X ms`)
- **Cause**: Model parameter count is too large for the host CPU/GPU, or context window is excessively large.
- **Resolution**:
  - Increase `OLLAMA_TIMEOUT_MS` in `.env` (e.g. `120000`).
  - Use a smaller or quantized model (e.g., switch from `27b` to `8b` or `3b`).
  - Check GPU offloading: Run `ollama ps` while generating to verify if GPU layers are loaded.

### Issue 4: Out-of-Memory (OOM) Errors
- **Cause**: Model size exceeds combined VRAM and system memory.
- **Resolution**:
  - In `services/api/src/services/inference/ollama-provider.ts`, context window (`num_ctx`) defaults to `4096`. For constrained systems, reduce to `2048`.
  - Close other memory-intensive processes.
  - Ensure swap or pagefile has at least 16GB allocated.

