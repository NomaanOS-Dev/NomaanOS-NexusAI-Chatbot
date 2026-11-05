-- 001_create_nexus_foundation.sql
-- NomaanOS Nexus AI: Initial Database Foundation & Entities

-- 1. Enable pgvector extension for high-performance vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Organizations: Top-level tenant container
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- 3. Workspaces: Operational tenant boundaries
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_organization ON workspaces(organization_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);

-- 4. Users & Authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_nexus_users_email UNIQUE (email)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nexus_users_email_lower ON users (LOWER(email));

-- 5. Workspace Memberships & RBAC
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_nexus_workspace_member UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nexus_memberships_user ON workspace_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_nexus_memberships_workspace_role ON workspace_memberships(workspace_id, role);

-- 6. Sessions (SHA-256 Hashed Tokens)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token_hash VARCHAR(64) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent VARCHAR(512) NULL,
    ip_address VARCHAR(45) NULL
);

CREATE INDEX IF NOT EXISTS idx_nexus_sessions_user_expires ON sessions(user_id, expires_at);

-- 7. Applications: Host web applications authorized to embed Nexus AI
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    app_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_app_key UNIQUE (workspace_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_applications_workspace ON applications(workspace_id);

-- 8. Assistants: Configurable AI personas & model policies
CREATE TABLE IF NOT EXISTS assistants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    application_id UUID NULL REFERENCES applications(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    assistant_key VARCHAR(128) NOT NULL,
    description TEXT NULL,
    system_prompt TEXT NOT NULL,
    model_policy VARCHAR(32) NOT NULL DEFAULT 'cloud-preferred' CHECK (model_policy IN ('local-only', 'cloud-preferred', 'hybrid', 'cloud-only')),
    temperature NUMERIC(3,2) NOT NULL DEFAULT 0.20 CHECK (temperature >= 0.0 AND temperature <= 2.0),
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    public_embed_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    avatar_url TEXT NULL,
    theme JSONB NOT NULL DEFAULT '{}'::jsonb,
    greeting_message TEXT NULL,
    suggested_prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_assistant_key UNIQUE (workspace_id, assistant_key)
);

CREATE INDEX IF NOT EXISTS idx_assistants_workspace ON assistants(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assistants_application ON assistants(application_id);

-- 9. Knowledge Spaces: Logical domains for organizing documents
CREATE TABLE IF NOT EXISTS knowledge_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_knowledge_slug UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_spaces_workspace ON knowledge_spaces(workspace_id);

-- 10. Assistant to Knowledge Spaces Association
CREATE TABLE IF NOT EXISTS assistant_knowledge_spaces (
    assistant_id UUID NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
    knowledge_space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (assistant_id, knowledge_space_id)
);

-- 11. Document Sources
CREATE TABLE IF NOT EXISTS document_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'error', 'archived')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_sources_workspace ON document_sources(workspace_id);
CREATE INDEX IF NOT EXISTS idx_document_sources_space ON document_sources(knowledge_space_id);
CREATE INDEX IF NOT EXISTS idx_document_sources_sha256 ON document_sources(workspace_id, sha256);

-- 12. Document Versions
CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    version_number INT NOT NULL DEFAULT 1,
    sha256 VARCHAR(64) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_source_version UNIQUE (source_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_source ON document_versions(source_id);

-- 13. Document Chunks (Full-Text Search + pgvector Embeddings)
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    token_count INT NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(768) NULL,
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_version_chunk_index UNIQUE (version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_workspace ON document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chunks_knowledge ON document_chunks(knowledge_space_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON document_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING GIN(tsv);

-- pgvector HNSW Index for Cosine Similarity Search
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
    ON document_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 14. Durable Ingestion Jobs Queue
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    locked_at TIMESTAMPTZ NULL,
    locked_by VARCHAR(64) NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claimable 
    ON ingestion_jobs(status, lease_expires_at, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_workspace 
    ON ingestion_jobs(workspace_id);

-- 15. Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    assistant_id UUID NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    anonymous_session_token VARCHAR(64) NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_user 
    ON conversations(workspace_id, created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_assistant 
    ON conversations(assistant_id);

-- 16. Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    token_count INT NOT NULL DEFAULT 0,
    finish_reason VARCHAR(32) NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
    ON messages(conversation_id, created_at ASC);

-- 17. Message Citations
CREATE TABLE IF NOT EXISTS message_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    citation_index INT NOT NULL,
    source_title VARCHAR(255) NOT NULL,
    excerpt TEXT NOT NULL,
    relevance_score FLOAT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citations_message ON message_citations(message_id);

-- 18. Audit Events (Append-only governance trail)
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_created 
    ON audit_events(workspace_id, created_at DESC);

