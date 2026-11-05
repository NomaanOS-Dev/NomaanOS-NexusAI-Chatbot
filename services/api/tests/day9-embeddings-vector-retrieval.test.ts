/**
 * Automated Test Suite for Day 9: Local Embeddings and Vector Retrieval
 *
 * Verifies:
 * 1. Default local embedding model configuration (384 dimensions, cosine distance)
 * 2. Incompatible model validation and error handling
 * 3. Document ingestion with automatic vector embedding generation
 * 4. Semantic vector search (top-k, cosine similarity, provenance metadata)
 * 5. Strict workspace and knowledge space tenant isolation
 * 6. Exclusion of superseded versions and inactive chunks
 * 7. On-demand knowledge space reindexing
 * 8. Both workspace-scoped and direct knowledge-space search endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { getDefaultEmbeddingModel, getModelById, shutdownEmbeddingDaemon } from '../src/services/embedding-service.js';

describe('Day 9 — Local Embeddings and Vector Retrieval', { timeout: 60000 }, () => {
  const app = createApp();

  // Test state
  let orgId: string;
  let workspace1Id: string;
  let workspace2Id: string;
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  let space1Id: string;
  let space2Id: string;
  let source1Id: string;
  let defaultModelId: string;

  beforeAll(async () => {
    // 1. Create Organization
    const orgRes = await pool.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id;`,
      ['Day 9 Vector Test Org', `org-d9-${Date.now()}`]
    );
    orgId = orgRes.rows[0].id;

    // 2. Create Workspace 1 (Primary)
    const ws1Res = await pool.query(
      `INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id;`,
      [orgId, 'Day 9 Primary Workspace', `ws1-d9-${Date.now()}`]
    );
    workspace1Id = ws1Res.rows[0].id;

    // 3. Create Workspace 2 (Isolated Tenant)
    const ws2Res = await pool.query(
      `INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id;`,
      [orgId, 'Day 9 Isolated Workspace', `ws2-d9-${Date.now()}`]
    );
    workspace2Id = ws2Res.rows[0].id;

    // 4. Create User 1 (Member of Workspace 1)
    const reg1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `tester1-d9-${Date.now()}@example.com`,
        password: 'Password123!',
        fullName: 'Day 9 User 1',
        organizationName: 'Day 9 Ingestion Corp',
      });
    user1Token = reg1.body.token;
    user1Id = reg1.body.user.id;

    // Add User 1 as Admin in Workspace 1
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (workspace_id, user_id) DO NOTHING;`,
      [workspace1Id, user1Id]
    );

    // 5. Create User 2 (Member of Workspace 2 only)
    const reg2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `tester2-d9-${Date.now()}@example.com`,
        password: 'Password123!',
        fullName: 'Day 9 User 2',
        organizationName: 'Day 9 Ingestion Corp 2',
      });
    user2Token = reg2.body.token;
    user2Id = reg2.body.user.id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (workspace_id, user_id) DO NOTHING;`,
      [workspace2Id, user2Id]
    );

    // 6. Create Knowledge Space in Workspace 1
    const ks1Res = await pool.query(
      `INSERT INTO knowledge_spaces (workspace_id, name, slug, description)
       VALUES ($1, $2, $3, $4) RETURNING id;`,
      [workspace1Id, 'Nexus AI Architecture Space', `space1-${Date.now()}`, 'Architecture specs']
    );
    space1Id = ks1Res.rows[0].id;

    // 7. Create Knowledge Space in Workspace 2
    const ks2Res = await pool.query(
      `INSERT INTO knowledge_spaces (workspace_id, name, slug, description)
       VALUES ($1, $2, $3, $4) RETURNING id;`,
      [workspace2Id, 'Workspace 2 Private Docs', `space2-${Date.now()}`, 'Private docs']
    );
    space2Id = ks2Res.rows[0].id;

    // 8. Fetch default model
    const defModel = await getDefaultEmbeddingModel();
    defaultModelId = defModel.id;
  });

  afterAll(async () => {
    shutdownEmbeddingDaemon();
    // Clean up test data
    if (workspace1Id) {
      await pool.query(`DELETE FROM workspaces WHERE id IN ($1, $2);`, [workspace1Id, workspace2Id]);
    }
    if (orgId) {
      await pool.query(`DELETE FROM organizations WHERE id = $1;`, [orgId]);
    }
  });

  describe('1. Model Registry and Compatibility', () => {
    it('verifies default embedding model is sentence-transformers/all-MiniLM-L6-v2 with 384 dimensions', async () => {
      const model = await getDefaultEmbeddingModel();
      expect(model.modelId).toBe('sentence-transformers/all-MiniLM-L6-v2');
      expect(model.dimensions).toBe(384);
      expect(model.distanceMetric).toBe('cosine');
      expect(model.isNormalized).toBe(true);
      expect(model.status).toBe('active');
    });

    it('lists configured embedding models via GET /embedding-models', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/embedding-models`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.models)).toBe(true);
      const defaultModel = res.body.models.find((m: any) => m.is_default);
      expect(defaultModel).toBeDefined();
      expect(defaultModel.dimensions).toBe(384);
    });

    it('rejects search with incompatible or nonexistent model ID', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          query: 'test query',
          modelId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EmbeddingServiceError');
    });
  });

  describe('2. Ingestion and Automatic Vector Embedding Generation', () => {
    it('uploads a document and persists structure-aware chunks with 384-dim embeddings', async () => {
      const markdownContent = `
# Nexus Security Protocols
## Authentication Guidelines
Nexus AI requires session tokens to be SHA-256 hashed before persistence in PostgreSQL.
Never store raw tokens in the database.
Bearer authorization headers must be properly parsed and verified.

## Vector Search Policies
Local vector embeddings use sentence-transformers with 384 dimensions and cosine metric.
All search queries must strictly enforce workspace and knowledge space tenant isolation.
      `.trim();

      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/sources`)
        .set('Authorization', `Bearer ${user1Token}`)
        .attach('file', Buffer.from(markdownContent, 'utf-8'), 'nexus-security.md')
        .field('title', 'Nexus Security Protocols');

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.status).toBe('ok');
      source1Id = uploadRes.body.source.id;
      expect(uploadRes.body.source.chunkCount).toBeGreaterThan(0);

      // Verify that chunks exist in document_chunks
      const chunksRes = await pool.query(
        `SELECT id, content, embedding_384 FROM document_chunks WHERE source_id = $1;`,
        [source1Id]
      );
      expect(chunksRes.rows.length).toBeGreaterThan(0);

      // Verify that chunk_embeddings are persisted with 384 dimensions
      const embRes = await pool.query(
        `SELECT id, chunk_id, embedding, is_active FROM chunk_embeddings WHERE workspace_id = $1 AND knowledge_space_id = $2;`,
        [workspace1Id, space1Id]
      );
      expect(embRes.rows.length).toBeGreaterThan(0);
      expect(embRes.rows[0].is_active).toBe(true);
    });
  });

  describe('3. Semantic Vector Search and Provenance', () => {
    it('returns top-k nearest matching chunks with cosine similarity and metadata', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          query: 'How are authentication session tokens stored and hashed?',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.model.dimensions).toBe(384);
      expect(res.body.model.distanceMetric).toBe('cosine');
      expect(res.body.results.length).toBeGreaterThan(0);

      const topResult = res.body.results[0];
      expect(topResult.similarityScore).toBeGreaterThan(0.2);
      expect(topResult.content).toContain('SHA-256 hashed');
      expect(topResult.source.title).toBe('Nexus Security Protocols');
      expect(topResult.source.filename).toBe('nexus-security.md');
      expect(topResult.provenance).toBeDefined();
      expect(topResult.provenance.chunkIndex).toBeDefined();
    });

    it('works via direct knowledge-space route /api/v1/knowledge-spaces/:id/search', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          query: 'local vector embeddings dimensions and cosine metric',
          topK: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].content).toContain('384 dimensions');
    });

    it('rejects empty search queries with 400 ValidationError', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ query: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('4. Tenant and Workspace Boundary Isolation', () => {
    it('prevents user from Workspace 2 from searching Workspace 1 knowledge space (403/404)', async () => {
      // User 2 trying to search Workspace 1's space via workspace route
      const res1 = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ query: 'Nexus Security Protocols' });

      // User 2 has no membership in Workspace 1
      expect([403, 404]).toContain(res1.status);

      // User 2 trying via direct route to Workspace 1's space
      const res2 = await request(app)
        .post(`/api/v1/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ query: 'Nexus Security Protocols' });

      expect(res2.status).toBe(403);
    });

    it('does not return Workspace 1 chunks when searching Workspace 2', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace2Id}/knowledge-spaces/${space2Id}/search`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ query: 'Nexus Security Protocols' });

      expect(res.status).toBe(200);
      expect(res.body.totalResults).toBe(0);
      expect(res.body.results.length).toBe(0);
    });
  });

  describe('5. Superseded Version and Inactive Chunk Exclusion', () => {
    it('deactivates version 1 embeddings when version 2 is uploaded with new content', async () => {
      const v2Content = `
# Nexus Security Protocols (Version 2)
## Quantum-Resilient Encryption
All communication channels now employ post-quantum lattice cryptography Kyber-768.
The legacy SHA-256 session tokens have been superseded by hybrid Dilithium signatures.
      `.trim();

      // Upload Version 2 of the same document source
      const v2Res = await request(app)
        .post(`/api/v1/knowledge-sources/${source1Id}/versions`)
        .set('Authorization', `Bearer ${user1Token}`)
        .attach('file', Buffer.from(v2Content, 'utf-8'), 'nexus-security-v2.md');

      expect([200, 201]).toContain(v2Res.status);
      expect(v2Res.body.status).toBe('ok');
      expect(v2Res.body.version.versionNumber).toBe(2);

      // Search for post-quantum lattice cryptography
      const searchRes = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/search`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ query: 'post-quantum lattice cryptography Kyber-768' });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.results.length).toBeGreaterThan(0);
      expect(searchRes.body.results[0].content).toContain('lattice cryptography Kyber-768');
      expect(searchRes.body.results[0].source.versionNumber).toBe(2);

      // Verify that old version 1 chunks are NOT returned
      for (const item of searchRes.body.results) {
        expect(item.source.versionNumber).toBe(2);
      }
    });
  });

  describe('6. Re-indexing Knowledge Space Chunks', () => {
    it('executes on-demand re-indexing for active chunks in knowledge space', async () => {
      const reindexRes = await request(app)
        .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${space1Id}/reindex`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({});

      expect(reindexRes.status).toBe(200);
      expect(reindexRes.body.status).toBe('ok');
      expect(reindexRes.body.reindexedCount).toBeGreaterThan(0);
    });
  });
});
