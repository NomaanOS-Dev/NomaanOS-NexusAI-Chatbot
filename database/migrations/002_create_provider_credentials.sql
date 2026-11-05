-- 002_create_provider_credentials.sql
-- NomaanOS Nexus AI: Encrypted Provider Credentials Storage

CREATE TABLE IF NOT EXISTS provider_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL CHECK (provider IN ('openai', 'gemini', 'anthropic', 'ollama', 'custom')),
    key_name VARCHAR(128) NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    key_fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_provider UNIQUE (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_workspace 
    ON provider_credentials(workspace_id);

