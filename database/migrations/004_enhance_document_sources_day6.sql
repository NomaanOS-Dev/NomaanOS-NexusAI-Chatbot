-- ============================================================================
-- Migration 004: Enhance Document Sources & Versions for Day 6 Ingestion Pipeline
-- Adds support for Day 6 extraction states, warnings, extracted data, and assistant mapping
-- ============================================================================

-- 1. Drop previous status check constraint and apply expanded status constraint
DO $$
BEGIN
    ALTER TABLE document_sources DROP CONSTRAINT IF EXISTS document_sources_status_check;
    ALTER TABLE document_sources 
        ADD CONSTRAINT document_sources_status_check 
        CHECK (status IN (
            'uploaded',
            'processing',
            'completed',
            'completed_with_warnings',
            'failed',
            'pending',
            'ready',
            'error',
            'archived'
        ));
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Constraint update handled: %', SQLERRM;
END $$;

-- 2. Add Day 6 extraction tracking columns to document_sources
ALTER TABLE document_sources
    ADD COLUMN IF NOT EXISTS extraction_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
    ADD COLUMN IF NOT EXISTS extracted_text TEXT NULL,
    ADD COLUMN IF NOT EXISTS extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS assistant_id UUID NULL REFERENCES assistants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ NULL;

-- 3. Add extracted data storage to document_versions
ALTER TABLE document_versions
    ADD COLUMN IF NOT EXISTS extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS raw_content TEXT NULL;

-- 4. Create performance indexes for document sources
CREATE INDEX IF NOT EXISTS idx_document_sources_status 
    ON document_sources(status);

CREATE INDEX IF NOT EXISTS idx_document_sources_assistant 
    ON document_sources(assistant_id);

CREATE INDEX IF NOT EXISTS idx_document_sources_created 
    ON document_sources(workspace_id, created_at DESC);

