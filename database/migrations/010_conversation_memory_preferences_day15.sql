-- Day 15: Conversation Context, Memory, Summaries, User Preferences, and Retention

-- 1. Conversation Summaries (Durable condensed context for older messages)
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    up_to_message_id UUID NULL REFERENCES messages(id) ON DELETE SET NULL,
    unresolved_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_count_covered INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_conversation_summary UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conv 
    ON conversation_summaries(conversation_id);

-- 2. User Preferences (Optional, user-controlled persistent settings)
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    language VARCHAR(16) NOT NULL DEFAULT 'en',
    response_style VARCHAR(32) NOT NULL DEFAULT 'standard' 
        CHECK (response_style IN ('concise', 'detailed', 'standard', 'bullet_points', 'executive')),
    code_theme VARCHAR(32) NULL DEFAULT 'dark',
    custom_instructions TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_workspace_pref 
    ON user_preferences (user_id, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_user_preferences_user 
    ON user_preferences(user_id);

-- 3. Workspace Retention Policies
CREATE TABLE IF NOT EXISTS workspace_retention_policies (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_retention_days INT NOT NULL DEFAULT 90,
    summary_retention_days INT NOT NULL DEFAULT 180,
    preferences_retention_days INT NOT NULL DEFAULT 365,
    auto_purge_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

