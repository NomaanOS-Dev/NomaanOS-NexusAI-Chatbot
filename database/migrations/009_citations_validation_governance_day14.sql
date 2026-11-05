-- Day 14: Citations, Claim Validation, Contradictions, and Tool Execution Verification

-- 1. Enhance message_citations with Day 14 provenance, verification status, and links
ALTER TABLE message_citations
    ADD COLUMN IF NOT EXISTS section_path TEXT NULL,
    ADD COLUMN IF NOT EXISTS page_number INT NULL,
    ADD COLUMN IF NOT EXISTS version_number INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS source_url TEXT NULL,
    ADD COLUMN IF NOT EXISTS validation_status VARCHAR(32) NOT NULL DEFAULT 'verified'
        CHECK (validation_status IN ('verified', 'unverified', 'invalid', 'inaccessible', 'fabricated')),
    ADD COLUMN IF NOT EXISTS validation_reason TEXT NULL,
    ADD COLUMN IF NOT EXISTS claim_support_score FLOAT NULL;

CREATE INDEX IF NOT EXISTS idx_citations_validation 
    ON message_citations(validation_status);

-- 2. Create tool_executions table for durable tool verification and audit trails
CREATE TABLE IF NOT EXISTS tool_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id UUID NULL REFERENCES messages(id) ON DELETE SET NULL,
    tool_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'running', 'success', 'failed', 'unverified')),
    input_arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_payload JSONB NULL,
    error_message TEXT NULL,
    verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_conversation 
    ON tool_executions(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_status 
    ON tool_executions(status);

