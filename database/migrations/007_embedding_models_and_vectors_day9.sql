-- ============================================================================
-- Migration 007: Local Embedding Models Registry and Vector Storage (Day 9)
-- Supports local 384-dimensional embeddings (sentence-transformers/all-MiniLM-L6-v2)
-- Enables multi-model compatibility, HNSW indexing, and tenant-scoped retrieval.
-- ============================================================================

-- 1. Embedding Models Registry
-- Tracks model specifications, dimensions, metrics, and default statuses
CREATE TABLE IF NOT EXISTS embedding_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id VARCHAR(128) NOT NULL UNIQUE, -- e.g. 'sentence-transformers/all-MiniLM-L6-v2'
    model_name VARCHAR(255) NOT NULL,
    provider VARCHAR(64) NOT NULL DEFAULT 'local',
    dimensions INT NOT NULL DEFAULT 384,
    distance_metric VARCHAR(32) NOT NULL DEFAULT 'cosine' CHECK (distance_metric IN ('cosine', 'l2', 'inner_product')),
    is_normalized BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embedding_models_status ON embedding_models(status);
CREATE INDEX IF NOT EXISTS idx_embedding_models_default ON embedding_models(is_default) WHERE is_default = TRUE;

-- 2. Seed Default Model: sentence-transformers/all-MiniLM-L6-v2 (384 dimensions, cosine distance)
INSERT INTO embedding_models (model_id, model_name, provider, dimensions, distance_metric, is_normalized, is_default, status, metadata)
VALUES (
    'sentence-transformers/all-MiniLM-L6-v2',
    'all-MiniLM-L6-v2',
    'local',
    384,
    'cosine',
    TRUE,
    TRUE,
    'active',
    '{"max_sequence_length": 256, "pooling": "mean", "hf_hub": "sentence-transformers/all-MiniLM-L6-v2"}'::jsonb
)
ON CONFLICT (model_id) DO UPDATE
SET is_default = TRUE, status = 'active', updated_at = NOW();

-- 3. Dedicated Multi-Model Chunk Embeddings Table (pgvector 384-dim)
CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
    embedding vector(384) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_scope 
    ON chunk_embeddings(workspace_id, knowledge_space_id, is_active);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model 
    ON chunk_embeddings(model_id, is_active);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_chunk 
    ON chunk_embeddings(chunk_id);

-- High-performance HNSW vector cosine similarity index
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_hnsw 
    ON chunk_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 4. Compatible Extension to document_chunks: embedding_384 column for high-speed direct single-table queries
ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS embedding_384 vector(384) NULL;

CREATE INDEX IF NOT EXISTS idx_chunks_embedding_384_hnsw 
    ON document_chunks USING hnsw (embedding_384 vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

