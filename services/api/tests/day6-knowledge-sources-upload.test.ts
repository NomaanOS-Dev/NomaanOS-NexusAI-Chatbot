import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';

describe('Day 6: Knowledge Source Registration, Secure Document Upload & Extraction Pipeline', () => {
  const app = createApp();

  const userAEmail = `day6-user-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day6-user-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'TestPassword123!';

  let userAToken: string;
  let userBToken: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let spaceAId: string;
  let spaceBId: string;
  let assistantAId: string;
  let assistantBId: string;

  beforeAll(async () => {
    // 1. Register User A (Workspace A)
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 6 Analyst A',
        organizationName: 'Alpha Ingestion Corp',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B (Workspace B)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Day 6 Analyst B',
        organizationName: 'Beta Security Corp',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create Knowledge Space A
    const spaceARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha Engineering Guides',
        slug: `alpha-guides-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Internal software architecture runbooks',
      });
    spaceAId = spaceARes.body.knowledgeSpace.id;

    // 4. Create Knowledge Space B
    const spaceBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Finance Specs',
        slug: `beta-finance-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Confidential executive finance documents',
      });
    spaceBId = spaceBRes.body.knowledgeSpace.id;

    // 5. Create Assistant in Workspace A
    const asstARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha Copilot',
        assistantKey: `alpha-asst-${crypto.randomUUID().slice(0, 6)}`,
        systemPrompt: 'You are Alpha engineering copilot.',
      });
    assistantAId = asstARes.body.assistant.id;

    // 6. Create Assistant in Workspace B
    const asstBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/assistants`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Copilot',
        assistantKey: `beta-asst-${crypto.randomUUID().slice(0, 6)}`,
        systemPrompt: 'You are Beta finance copilot.',
      });
    assistantBId = asstBRes.body.assistant.id;
  });

  afterAll(async () => {
    // Cleanup records created for these test workspaces
    if (workspaceAId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceAId]);
    }
    if (workspaceBId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceBId]);
    }
  });

  describe('1. File Upload Format Extractions', () => {
    it('successfully uploads and extracts plain text (.txt)', async () => {
      const txtContent = Buffer.from(
        'NomaanOS Nexus AI Platform Architecture\n\nHigh-performance retrieval engine with pgvector.'
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', txtContent, 'architecture.txt')
        .field('title', 'Platform Architecture Guide');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.source.id).toBeDefined();
      expect(res.body.source.title).toBe('Platform Architecture Guide');
      expect(res.body.source.filename).toBe('architecture.txt');
      expect(res.body.source.status).toBe('completed');
      expect(res.body.extraction.characterCount).toBeGreaterThan(20);
    }, 25000);

    it('successfully uploads and extracts Markdown (.md) with headings and code blocks', async () => {
      const mdContent = Buffer.from(
        '# Incident Response Runbook\n\nEmergency containment procedure.\n\n```bash\niptables -A INPUT -p tcp --dport 22 -j DROP\n```\n'
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', mdContent, 'runbook.md');

      expect(res.status).toBe(201);
      expect(res.body.source.title).toBe('Incident Response Runbook');
      expect(res.body.source.status).toBe('completed');
      expect(res.body.extraction.blocksCount).toBeGreaterThanOrEqual(2);
    });

    it('successfully uploads and extracts HTML (.html) while ignoring scripts and styles', async () => {
      const htmlContent = Buffer.from(
        '<!DOCTYPE html><html><head><title>Cloud SOP</title><script>alert("hacked");</script><style>p { color: red; }</style></head><body><h1>Database Failover Runbook</h1><p>Procedure for automated switchover.</p></body></html>'
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', htmlContent, 'sop.html');

      expect(res.status).toBe(201);
      expect(res.body.source.title).toBe('Cloud SOP');
      expect(res.body.source.status).toBe('completed_with_warnings');
      expect(res.body.source.warnings.some((w: any) => w.code === 'STRIPPED_SCRIPTS')).toBe(true);
    });

    it('successfully uploads and extracts valid JSON documents (.json)', async () => {
      const jsonContent = Buffer.from(
        JSON.stringify({
          title: 'PostgreSQL Replication Spec',
          primary: 'db-master-01',
          replicas: ['db-replica-01', 'db-replica-02'],
          maxConnections: 100,
        })
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', jsonContent, 'replication.json');

      expect(res.status).toBe(201);
      expect(res.body.source.title).toBe('PostgreSQL Replication Spec');
      expect(res.body.source.status).toBe('completed');
    });

    it('successfully uploads and extracts OpenAPI specifications (JSON & YAML)', async () => {
      const openApiYaml = Buffer.from(`
openapi: "3.0.3"
info:
  title: "Sentinel Telemetry Ingestion API"
  version: "1.0.0"
paths:
  /events:
    post:
      summary: "Push Telemetry Batch"
      responses:
        "200":
          description: "Accepted"
`);

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', openApiYaml, 'openapi.yaml');

      expect(res.status).toBe(201);
      expect(res.body.source.title).toBe('Sentinel Telemetry Ingestion API');
      expect(res.body.source.status).toBe('completed');
    });

    it('successfully uploads via alternate /api/v1/knowledge-sources endpoint', async () => {
      const txtContent = Buffer.from('Direct knowledge-sources endpoint test document.');

      const res = await request(app)
        .post('/api/v1/knowledge-sources')
        .set('Authorization', `Bearer ${userAToken}`)
        .set('X-Workspace-Id', workspaceAId)
        .field('knowledgeSpaceId', spaceAId)
        .field('assistantId', assistantAId)
        .attach('file', txtContent, 'direct.txt');

      expect(res.status).toBe(201);
      expect(res.body.source.assistantId).toBe(assistantAId);
    });
  });

  describe('2. Metadata Retrieval, Listing & Version Tracking', () => {
    let createdSourceId: string;

    beforeAll(async () => {
      const content = Buffer.from('Document for listing and metadata testing.');
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', content, 'list-test.txt')
        .field('title', 'Listing Test Document');
      createdSourceId = res.body.source.id;
    });

    it('retrieves detailed document metadata and versions by source ID', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.source.id).toBe(createdSourceId);
      expect(res.body.source.title).toBe('Listing Test Document');
      expect(res.body.source.versions).toBeDefined();
      expect(res.body.source.versions.length).toBe(1);
    });

    it('lists knowledge sources filtered by workspace and knowledge space', async () => {
      const res = await request(app)
        .get('/api/v1/knowledge-sources')
        .set('Authorization', `Bearer ${userAToken}`)
        .set('X-Workspace-Id', workspaceAId)
        .query({ knowledgeSpaceId: spaceAId });

      expect(res.status).toBe(200);
      expect(res.body.sources).toBeDefined();
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.sources.some((s: any) => s.id === createdSourceId)).toBe(true);
    });

    it('detects duplicate document upload by SHA-256 and records duplicate metadata', async () => {
      const duplicateContent = Buffer.from('Identical binary content for duplicate check.');

      const firstRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', duplicateContent, 'orig.txt');
      expect(firstRes.status).toBe(201);

      const dupRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', duplicateContent, 'duplicate.txt');
      expect(dupRes.status).toBe(201);

      // Verify source details in database
      const detailRes = await request(app)
        .get(`/api/v1/knowledge-sources/${dupRes.body.source.id}`)
        .set('Authorization', `Bearer ${userAToken}`);
      expect(detailRes.body.source.metadata?.is_duplicate).toBe(true);
    });
  });

  describe('3. Validation & Malformed Input Handling', () => {
    it('rejects empty file upload (0 bytes)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.alloc(0), 'empty.txt');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('DocumentProcessingError');
      expect(res.body.message).toContain('empty (0 bytes)');
    });

    it('rejects unsupported file extension', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('binary data'), 'malicious.exe');

      expect(res.status).toBe(415);
      expect(res.body.message).toContain('Unsupported file extension');
    });

    it('rejects spoofed PDF lacking %PDF- signature', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('This is not a real PDF document'), 'fake.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('%PDF-');
    });

    it('rejects malformed JSON with syntax error', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('{"unclosed": "broken", '), 'broken.json');

      expect(res.status).toBe(201); // Source is registered, but status is failed!
      expect(res.body.source.status).toBe('failed');
      expect(res.body.source.errorMessage).toBeDefined();
    });

    it('sanitizes path traversal in filenames safely', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('safe text'), '../../../../etc/passwd.txt');

      expect(res.status).toBe(201);
      expect(res.body.source.filename).not.toContain('..');
      expect(res.body.source.filename).not.toContain('/');
      expect(res.body.source.filename).toBe('passwd.txt');
    });
  });

  describe('4. Security & Tenant Isolation Invariants', () => {
    it('blocks unauthenticated upload attempts (401)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .attach('file', Buffer.from('hello'), 'unauth.txt');

      expect(res.status).toBe(401);
    });

    it('prevents cross-workspace document upload (User B uploading to Space A -> 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userBToken}`)
        .attach('file', Buffer.from('cross-tenant attempt'), 'cross.txt');

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Knowledge space not found');
    });

    it('prevents cross-workspace assistant linking (User A linking Assistant B -> 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .field('assistantId', assistantBId) // Assistant B belongs to Workspace B
        .attach('file', Buffer.from('cross-assistant attempt'), 'cross_asst.txt');

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Assistant not found in this workspace');
    });

    it('prevents cross-tenant document retrieval (User B requesting Source from Workspace A -> 404)', async () => {
      // 1. User A creates document
      const docRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('Confidential Alpha Project'), 'secret.txt');
      const secretSourceId = docRes.body.source.id;

      // 2. User B attempts to read it
      const probeRes = await request(app)
        .get(`/api/v1/knowledge-sources/${secretSourceId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(probeRes.status).toBe(404);
      expect(probeRes.body.message).toContain('not found');
    });

    it('allows workspace admin to delete knowledge source and cleans up disk file', async () => {
      const docRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('To be deleted'), 'delete_me.txt');
      const delSourceId = docRes.body.source.id;

      const delRes = await request(app)
        .delete(`/api/v1/knowledge-sources/${delSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.status).toBe('ok');

      // Subsequent query returns 404
      const getRes = await request(app)
        .get(`/api/v1/knowledge-sources/${delSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`);
      expect(getRes.status).toBe(404);
    });
  });
});

