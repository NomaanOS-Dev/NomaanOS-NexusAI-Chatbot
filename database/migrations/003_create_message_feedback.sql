-- 003_create_message_feedback.sql
-- NomaanOS Nexus AI: Message feedback & evaluation ratings

CREATE TABLE IF NOT EXISTS message_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    anonymous_session_token VARCHAR(64) NULL,
    rating VARCHAR(16) NOT NULL CHECK (rating IN ('positive', 'negative', 'thumbs_up', 'thumbs_down')),
    comment TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index ensuring one feedback record per message per authenticated user
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_message_user 
    ON message_feedback(message_id, user_id) 
    WHERE user_id IS NOT NULL;

-- Unique index ensuring one feedback record per message per anonymous guest session
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_message_anon 
    ON message_feedback(message_id, anonymous_session_token) 
    WHERE anonymous_session_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON message_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_workspace ON message_feedback(workspace_id);
CREATE INDEX IF NOT EXISTS idx_feedback_message ON message_feedback(message_id);

