-- Migration 006: Durable Ingestion Jobs, State Machine, Leases, and Connectors (Day 8)
-- Extends the initial ingestion_jobs table created in 001 without data loss or dropping tables.

-- 1. Add missing lifecycle, lease, diagnostic, and connector columns to ingestion_jobs
ALTER TABLE ingestion_jobs
    ADD COLUMN IF NOT EXISTS knowledge_space_id UUID NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS job_type VARCHAR(64) NOT NULL DEFAULT 'document_ingest',
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS timeout_seconds INT NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS lease_duration_seconds INT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS error_code VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS diagnostic_message TEXT NULL,
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128) NULL,
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128) NULL,
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Update status CHECK constraint to allow 'retry_waiting'
ALTER TABLE ingestion_jobs 
    DROP CONSTRAINT IF EXISTS ingestion_jobs_status_check;

ALTER TABLE ingestion_jobs 
    ADD CONSTRAINT ingestion_jobs_status_check 
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled', 'retry_waiting'));

-- 3. Replace/Create high-efficiency claim index for FOR UPDATE SKIP LOCKED
DROP INDEX IF EXISTS idx_ingestion_jobs_claimable;

CREATE INDEX idx_ingestion_jobs_claimable 
    ON ingestion_jobs (status, scheduled_at, lease_expires_at)
    WHERE status IN ('queued', 'processing', 'retry_waiting');

-- 4. Partial unique index for idempotency per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_idempotency 
    ON ingestion_jobs (workspace_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'processing', 'retry_waiting');

-- 5. Authorized listing and filtering indexes
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_workspace_source 
    ON ingestion_jobs (workspace_id, source_id, status);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_workspace_created 
    ON ingestion_jobs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_knowledge_space 
    ON ingestion_jobs (knowledge_space_id);

