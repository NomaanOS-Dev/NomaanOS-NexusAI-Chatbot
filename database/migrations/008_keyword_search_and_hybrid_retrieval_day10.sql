-- ============================================================================
-- Migration 008: Full-Text Keyword Search & Hybrid Retrieval Indexes (Day 10)
-- Enables pg_trgm for exact technical codes, GIN indexes on metadata and paths,
-- and optimized composite indexes for tenant-scoped hybrid retrieval.
-- ============================================================================

-- 1. Enable pg_trgm extension for technical identifiers, error codes, and substrings
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Verify or add Full-Text Search GIN index on document_chunks (tsv)
CREATE INDEX IF NOT EXISTS idx_chunks_tsv 
    ON document_chunks USING GIN(tsv);

-- 3. GIN Trigram index on content for technical substring and error code lookups
CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm 
    ON document_chunks USING GIN (content gin_trgm_ops);

-- 4. GIN Trigram index on section_path for hierarchical header matching
CREATE INDEX IF NOT EXISTS idx_chunks_section_path_trgm 
    ON document_chunks USING GIN (section_path gin_trgm_ops);

-- 5. GIN indexes on JSONB metadata for fast structured and product filtering
CREATE INDEX IF NOT EXISTS idx_chunks_metadata_gin 
    ON document_chunks USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_sources_metadata_gin 
    ON document_sources USING GIN (metadata);

-- 6. Composite index for active tenant-scoped chunk retrieval
CREATE INDEX IF NOT EXISTS idx_chunks_hybrid_scope 
    ON document_chunks(workspace_id, knowledge_space_id, is_active, version_id);

