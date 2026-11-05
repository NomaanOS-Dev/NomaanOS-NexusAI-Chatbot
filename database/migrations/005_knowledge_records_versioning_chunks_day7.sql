-- ============================================================================
-- Migration 005: Knowledge Records, Versioning, and Chunk Access Policies (Day 7)
-- Adds supersession tracking, chunk traceability, section paths, and active lifecycle
-- ============================================================================

-- 1. Enhance document_versions with lifecycle and supersession tracking
ALTER TABLE document_versions
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'superseded', 'processing', 'archived', 'failed')),
    ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS supersedes_version_id UUID NULL REFERENCES document_versions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS superseded_by_version_id UUID NULL REFERENCES document_versions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS chunk_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tokens INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_document_versions_current 
    ON document_versions(source_id, is_current);

CREATE INDEX IF NOT EXISTS idx_document_versions_status 
    ON document_versions(status);

-- 2. Link document_sources to their currently active version
ALTER TABLE document_sources
    ADD COLUMN IF NOT EXISTS current_version_id UUID NULL REFERENCES document_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_sources_current_version 
    ON document_sources(current_version_id);

-- 3. Enhance document_chunks with traceability and active retrieval eligibility
ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS chunk_hash VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS section_path TEXT NULL,
    ADD COLUMN IF NOT EXISTS page_number INT NULL,
    ADD COLUMN IF NOT EXISTS source_offset INT NULL,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_chunks_active_scope 
    ON document_chunks(workspace_id, knowledge_space_id, is_active);

CREATE INDEX IF NOT EXISTS idx_chunks_version_active 
    ON document_chunks(version_id, is_active);

CREATE INDEX IF NOT EXISTS idx_chunks_hash 
    ON document_chunks(chunk_hash);

