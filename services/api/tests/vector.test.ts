import { describe, it, expect } from 'vitest';
import { pool, checkPgVectorAvailable } from '../src/database/pool.js';
import { v4 as uuidv4 } from 'uuid';

describe('pgvector Extension and Vector Operations', () => {
  it('confirms vector extension is enabled and reports version', async () => {
    const check = await checkPgVectorAvailable();
    expect(check.ok).toBe(true);
    expect(check.version).toBeDefined();
    expect(check.version).toMatch(/^[0-9]+\.[0-9]+/);
  });

  it('performs basic vector operations (cosine and euclidean distance)', async () => {
    const res = await pool.query(`
      SELECT 
        '[1, 2, 3]'::vector <=> '[1, 2, 4]'::vector AS cosine_distance,
        '[1, 2, 3]'::vector <-> '[1, 2, 4]'::vector AS euclidean_distance,
        '[1, 2, 3]'::vector <#> '[1, 2, 4]'::vector AS negative_inner_product;
    `);

    expect(res.rows.length).toBe(1);
    const row = res.rows[0];
    expect(parseFloat(row.cosine_distance)).toBeCloseTo(0.0085, 3);
    expect(parseFloat(row.euclidean_distance)).toBe(1);
    expect(parseFloat(row.negative_inner_product)).toBe(-17);
  });

  it('inserts and queries a 768-dimensional vector chunk with cosine ordering', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orgId = uuidv4();
      const wsId = uuidv4();
      const spaceId = uuidv4();
      const sourceId = uuidv4();
      const versionId = uuidv4();
      const chunkId = uuidv4();

      // 1. Create Organization
      await client.query(
        `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Test Org', $2)`,
        [orgId, `org-test-${Date.now()}`]
      );

      // 2. Create Workspace
      await client.query(
        `INSERT INTO workspaces (id, organization_id, name, slug) VALUES ($1, $2, 'Test WS', $3)`,
        [wsId, orgId, `ws-test-${Date.now()}`]
      );

      // 3. Create Knowledge Space
      await client.query(
        `INSERT INTO knowledge_spaces (id, workspace_id, name, slug) VALUES ($1, $2, 'Runbooks', 'runbooks')`,
        [spaceId, wsId]
      );

      // 4. Create Document Source
      await client.query(
        `INSERT INTO document_sources (id, workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256)
         VALUES ($1, $2, $3, 'Incident Guide', 'guide.md', 'text/markdown', 1024, '/tmp/guide.md', 'dummyhash123')`,
        [sourceId, wsId, spaceId]
      );

      // 5. Create Document Version
      await client.query(
        `INSERT INTO document_versions (id, source_id, version_number, sha256)
         VALUES ($1, $2, 1, 'dummyhash123')`,
        [versionId, sourceId]
      );

      // 6. Generate 768-dimensional test vector (normalized)
      const vectorA = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
      const vectorStrA = `[${vectorA.join(',')}]`;

      // Insert chunk
      await client.query(
        `INSERT INTO document_chunks (id, workspace_id, knowledge_space_id, source_id, version_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, 0, 'This is an incident response guide for SSH brute force.', $6)`,
        [chunkId, wsId, spaceId, sourceId, versionId, vectorStrA]
      );

      // Query chunk by cosine distance
      const queryVector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 0.99 : 0.01));
      const queryVectorStr = `[${queryVector.join(',')}]`;

      const searchRes = await client.query(
        `SELECT id, content, (embedding <=> $1) AS distance
         FROM document_chunks
         WHERE workspace_id = $2
         ORDER BY embedding <=> $1 ASC
         LIMIT 1`,
        [queryVectorStr, wsId]
      );

      expect(searchRes.rows.length).toBe(1);
      expect(searchRes.rows[0].id).toBe(chunkId);
      expect(parseFloat(searchRes.rows[0].distance)).toBeLessThan(0.05);

      // Roll back test data to keep database clean
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
});

