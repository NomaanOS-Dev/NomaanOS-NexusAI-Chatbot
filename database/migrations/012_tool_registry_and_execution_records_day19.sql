-- Day 19: Tool Registry, Controlled Agent Loop, Execution Logging & Security Records

CREATE TABLE IF NOT EXISTS tool_execution_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    assistant_id UUID NULL REFERENCES assistants(id) ON DELETE SET NULL,
    conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
    tool_name VARCHAR(128) NOT NULL,
    status VARCHAR(64) NOT NULL CHECK (
        status IN ('success', 'failed', 'rejected_unauthorized', 'validation_error', 'timed_out', 'cancelled')
    ),
    duration_ms INT NOT NULL DEFAULT 0,
    correlation_id VARCHAR(128) NULL,
    sanitized_arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_summary TEXT NULL,
    error_code VARCHAR(64) NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_exec_workspace ON tool_execution_records(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tool_exec_tool_name ON tool_execution_records(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_exec_status ON tool_execution_records(status);
CREATE INDEX IF NOT EXISTS idx_tool_exec_created_at ON tool_execution_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_exec_correlation ON tool_execution_records(correlation_id);

