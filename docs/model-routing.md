# Cloud Inference & Model Routing Architecture Guide
**NomaanOS Nexus AI — Day 17 Architecture**

This guide documents the intelligent model routing system, cloud inference integration (OpenAI & Anthropic), credential security standards, rate-limit resilience, task complexity classification, and operational telemetry.

---

## 1. System Architecture

Nexus AI decouples model inference from specific providers through a unified interface (`InferenceProvider`), dynamic capability registry (`ProviderRegistry`), and policy-driven routing engine (`ModelRouter`):

```
                       [ Incoming Request / Grounded Prompt ]
                                        │
                                        ▼
                             [ ModelRouter Service ]
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
        [ Policy Resolution ]                   [ Task Complexity Analysis ]
    - local-only                             - simple (greetings, quick lookups)
    - cloud-preferred                        - standard (grounded RAG questions)
    - hybrid                                 - complex (code, incident triage, >300 tokens)
    - cloud-only                                    │
                    │                               │
                    └───────────────────┬───────────┘
                                        ▼
                        [ ProviderRegistry Resolution ]
                   - Health & Rate-Limit Cooldown Check
                   - Dynamic AES-256-GCM Credential Lookup
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
      [ Local Ollama ]          [ Cloud: OpenAI ]         [ Cloud: Anthropic ]
   http://127.0.0.1:11434      api.openai.com/v1         api.anthropic.com/v1
   (llama3.1, qwen3.8)         (gpt-4o, gpt-4o-mini)     (claude-3-5-haiku, sonnet)
             │                          │                          │
             └──────────────────────────┼──────────────────────────┘
                                        ▼
                            [ Normalization Layer ]
                       - Stream Chunk Normalization
                       - Cost & Latency Estimation
                       - Fallback Coordination on Error
                                        │
                                        ▼
                        [ Usage & Failure Telemetry ]
                       - inference_usage_records (PostgreSQL)
                       - inference_failures (PostgreSQL)
                       - In-memory metrics buffer
```

---

## 2. Model Routing Policies

Nexus AI supports four routing policies, configurable at the workspace, assistant, or individual request level:

| Policy | Target Provider | Fallback Provider | Data Exposure Risk | Acceptance Criteria |
|---|---|---|---|---|
| **`local-only`** | Local (`ollama`) | Local (`local_deterministic`) | **Zero Exposure** (100% offline) | **Never silently falls back to cloud**. Cloud requests strictly rejected (HTTP 403). |
| **`cloud-preferred`** | Cloud (`openai` or `anthropic`) | Local (`ollama` / `local_deterministic`) | Cloud-bound when permitted | Attempts cloud; gracefully falls back to local on rate-limits, timeouts, or errors. |
| **`hybrid`** | Dynamic by task complexity | Local (`ollama`) | Minimal / Context-aware | Routes `complex` tasks to cloud models; routes `simple` and `standard` tasks locally. Sensitive data (`containsSensitiveData: true`) always stays local. |
| **`cloud-only`** | Cloud (`openai` or `anthropic`) | **None** (Strictly forbidden) | Cloud-bound | Requires cloud provider; fails immediately if unavailable or rate-limited. Never falls back to local. |

---

## 3. Task Complexity Evaluation Matrix

Under the `hybrid` policy, requests are automatically classified before provider selection:

```
[ Request Prompt & Metadata ]
              │
    ┌─────────┴────────────────────────────────────────┐
    │ 1. Sensitive Data Check                          │
    │    - containsSensitiveData == true? ──► FORCE LOCAL (Zero Exposure)
    └─────────┬────────────────────────────────────────┘
              │
    ┌─────────┴────────────────────────────────────────┐
    │ 2. Complexity Indicators                         │
    │    - Code blocks (``` / SQL / shell / functions) │
    │    - Security triage keywords                    │
    │    - Prompt tokens >= 300 threshold              │
    └─────────┬────────────────────────────────────────┘
              │
     Yes ─────┴───── No
      │               │
      ▼               ▼
 [ Complex ]    [ Standard / Simple ]
      │               │
      ▼               ▼
[ Cloud Model ]  [ Local Model ]
(gpt-4o-mini)    (ollama / qwen)
```

- **Simple Tasks**: Brief greetings (`"hello"`, `"greetings"`), single-word lookups, or prompts `< 40` tokens without punctuation. Routed locally for near-instant latency and \$0 cost.
- **Standard Tasks**: Standard RAG knowledge retrieval and fact extraction. Routed locally by default under hybrid mode.
- **Complex Tasks**: Technical code generation, architecture evaluations, deep security incident triage (`"root cause"`, `"threat model"`, `"forensics"`), or token lengths exceeding `HYBRID_COMPLEXITY_TOKEN_THRESHOLD=300`. Routed to high-capacity cloud models.

---

## 4. Rate-Limit Handling & Cooldown Architecture

When a cloud provider returns HTTP 429 Too Many Requests:
1. **Header Parsing**: The provider adapter reads the `Retry-After` header (defaulting to 30 seconds if omitted).
2. **Registry Cooldown**: `ProviderRegistry.markRateLimited(provider, retryAfterSeconds)` records a cooldown timestamp.
3. **Proactive Circuit Breaker**: Subsequent requests avoid making wasted network round-trips while the cooldown is active.
4. **Policy-Compliant Fallback**:
   - Under `cloud-preferred` or `hybrid`: immediately routes to local inference, recording a fallback event.
   - Under `cloud-only`: immediately throws a typed `RateLimitError` (HTTP 429).
5. **Automatic Reset**: Once the cooldown expires, the provider is automatically marked ready for cloud inference.

---

## 5. Credential Security & Masking

Provider API keys are protected at all lifecycle stages:
- **AES-256-GCM Storage**: Tenant credentials stored in `provider_credentials` are encrypted with an authenticated 96-bit initialization vector and derived master key.
- **Fingerprinting**: Keys are identified exclusively by their masked fingerprint (`sk-...1234`), never by plaintext.
- **Sanitized Logging**: All server logs, diagnostic dumps, and health checks redact API keys (`[REDACTED]`).
- **Authorization Boundary**: Access to credentials requires active workspace admin permissions (`requireWorkspaceAdmin`).

---

## 6. Observability & Telemetry

Usage and failures are recorded in real-time across both PostgreSQL tables and an in-memory sliding buffer:

### Database Tables (Migration `011_inference_routing_usage_day17.sql`)
- `inference_usage_records`: Tracks `prompt_tokens`, `completion_tokens`, `duration_ms`, `estimated_cost_usd`, `routing_policy`, `task_complexity`, and `status`.
- `inference_failures`: Tracks `provider`, `model`, `error_code`, `status_code`, `error_message`, and whether a fallback was triggered.

### Observability Metrics API
Query metrics via `GET /api/v1/inference/metrics`:
```json
{
  "status": "ok",
  "metrics": {
    "totalRequests": 142,
    "successfulRequests": 138,
    "failedRequests": 4,
    "fallbackRequests": 4,
    "totalPromptTokens": 18240,
    "totalCompletionTokens": 7910,
    "totalTokens": 26150,
    "totalEstimatedCostUsd": 0.005421,
    "averageDurationMs": 412,
    "providerBreakdown": {
      "openai": { "requests": 84, "failures": 4, "tokens": 15400, "costUsd": 0.005421 },
      "ollama": { "requests": 58, "failures": 0, "tokens": 10750, "costUsd": 0.0 }
    },
    "policyBreakdown": {
      "cloud-preferred": { "requests": 60, "fallbacks": 4 },
      "hybrid": { "requests": 50, "fallbacks": 0 },
      "local-only": { "requests": 32, "fallbacks": 0 }
    }
  }
}
```

---

## 7. API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/inference/policies` | `GET` | Lists all 4 routing policies with descriptions and active status. |
| `/api/v1/inference/health` | `GET` | Inspects health, readiness, and rate-limit states across all registered providers. |
| `/api/v1/inference/models` | `GET` | Discovers available models across local and cloud providers permitted by policy. |
| `/api/v1/inference/metrics` | `GET` | Returns aggregated token consumption, cost, and fallback telemetry. |
| `/api/v1/inference/generate` | `POST` | Executes direct model inference with custom policy, format (`json`/`text`), and streaming. |

