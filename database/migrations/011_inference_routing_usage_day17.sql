-- Day 17: Cloud Inference, Model Routing, Rate Limit Tracking, Usage and Failures

-- 1. Inference Usage Records
CREATE TABLE IF NOT EXISTS inference_usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    assistant_id UUID NULL REFERENCES assistants(id) ON DELETE SET NULL,
    conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    routing_policy VARCHAR(32) NOT NULL,
    task_complexity VARCHAR(32) NOT NULL DEFAULT 'standard',
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    duration_ms INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'fallback', 'failed', 'rate_limited')),
    fallback_provider VARCHAR(64) NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inference_usage_workspace ON inference_usage_records(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inference_usage_created ON inference_usage_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inference_usage_provider ON inference_usage_records(provider, model);

-- 2. Inference Failure Records
CREATE TABLE IF NOT EXISTS inference_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    error_code VARCHAR(64) NOT NULL,
    status_code INT NULL,
    error_message TEXT NOT NULL,
    routing_policy VARCHAR(32) NOT NULL,
    fallback_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    fallback_provider VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inference_failures_workspace ON inference_failures(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inference_failures_created ON inference_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inference_failures_provider ON inference_failures(provider);

