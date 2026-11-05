import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';

describe('Day 21: Project-Specific Knowledge Bases & Document Ingestion Pipeline', () => {
  const app = createApp();

  const userAEmail = `day21-admin-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day21-admin-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const viewerAEmail = `day21-viewer-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'TestPassword123!';

  let userAToken: string;
  let userBToken: string;
  let viewerAToken: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let spaceAId: string;
  let spaceBId: string;

  beforeAll(async () => {
    // 1. Register User A (Workspace A - Owner)
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Project Lead Alpha',
        organizationName: 'Alpha SaaS Solutions',
        workspaceName: 'Alpha Production Project',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B (Workspace B - Owner)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Project Lead Beta',
        organizationName: 'Beta Cloud Corp',
        workspaceName: 'Beta Staging Project',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Register Viewer User in Workspace A (only 'viewer' role)
    const regViewerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: viewerAEmail,
        password,
        fullName: 'Viewer User',
        organizationName: 'Alpha Readonly Org',
      });
    viewerAToken = regViewerRes.body.token;
    const viewerUserId = regViewerRes.body.user.id;

    // Add viewer to Workspace A with role 'viewer'
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'viewer')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'viewer';`,
      [workspaceAId, viewerUserId]
    );

    // 4. Create Knowledge Space in Workspace A
    const spaceARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha SaaS Knowledge Base',
        slug: `alpha-kb-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Primary customer support & API documentation',
      });
    expect(spaceARes.status).toBe(201);
    spaceAId = spaceARes.body.knowledgeSpace.id;

    // 5. Create Knowledge Space in Workspace B
    const spaceBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Isolated Knowledge Base',
        slug: `beta-kb-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Beta project private internal runbooks',
      });
    expect(spaceBRes.status).toBe(201);
    spaceBId = spaceBRes.body.knowledgeSpace.id;
  });

  afterAll(async () => {
    // Cleanup workspaces
    if (workspaceAId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceAId]);
    }
    if (workspaceBId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceBId]);
    }
  });

  // ===========================================================================
  // Task 1 & 2: Project-Specific Knowledge Space Association & Validation
  // ===========================================================================
  describe('1. Project Knowledge Space Creation & Association', () => {
    it('creates a project-specific knowledge base via supported backend API', async () => {
      const slug = `dev-docs-${crypto.randomUUID().slice(0, 6)}`;
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          name: 'Developer Reference Guides',
          slug,
          description: 'Comprehensive guides for SDK & REST API',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.knowledgeSpace.name).toBe('Developer Reference Guides');
      expect(res.body.knowledgeSpace.workspace_id).toBe(workspaceAId);
      expect(res.body.knowledgeSpace.slug).toBe(slug);
    });

    it('lists knowledge spaces associated with the active project', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.knowledgeSpaces)).toBe(true);
      expect(res.body.knowledgeSpaces.length).toBeGreaterThanOrEqual(1);
      const found = res.body.knowledgeSpaces.find((ks: any) => ks.id === spaceAId);
      expect(found).toBeDefined();
      expect(found.name).toBe('Alpha SaaS Knowledge Base');
    });

    it('rejects knowledge space creation with duplicate slug in same workspace', async () => {
      const duplicateSlug = `unique-slug-${crypto.randomUUID().slice(0, 6)}`;
      await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'First Space', slug: duplicateSlug });

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'Second Space', slug: duplicateSlug });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Conflict/);
    });
  });

  // ===========================================================================
  // Task 3 & 4: Upload Validation, Limits, and Supported Formats
  // ===========================================================================
  describe('2. Document Upload Validation & Size / Format Restrictions', () => {
    it('rejects empty file uploads (0 bytes) with 400 Bad Request', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', emptyBuffer, 'empty_doc.txt');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('empty (0 bytes)');
    });

    it('rejects files exceeding the maximum size limit of 15 MiB with 413 Payload Too Large', async () => {
      // 15 MiB + 1024 bytes
      const oversizedBuffer = Buffer.alloc(15 * 1024 * 1024 + 1024);
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', oversizedBuffer, 'oversized.pdf');

      expect([413, 400]).toContain(res.status);
      expect(res.body.message).toMatch(/(exceeds maximum|File size exceeds|15)/i);
    });

    it('rejects unsupported file formats (.exe, .bin) with 415 Unsupported Media Type', async () => {
      const binBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ executable header
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', binBuffer, 'malicious_installer.exe');

      expect(res.status).toBe(415);
      expect(res.body.message).toContain("Unsupported file extension '.exe'");
    });

    it('rejects fake PDF files missing the %PDF- magic signature with 400', async () => {
      const fakePdfBuffer = Buffer.from('This is a plain text file pretending to be a PDF.');
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', fakePdfBuffer, 'corrupted_report.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('%PDF-');
    });
  });

  // ===========================================================================
  // Task 4 & 5: Successful Document Ingestion & Real Processing States
  // ===========================================================================
  describe('3. Multi-Format Document Ingestion & State Lifecycle', () => {
    let uploadedMarkdownDocId: string;
    let uploadedJsonDocId: string;

    it('successfully uploads and extracts Markdown documentation (.md)', async () => {
      const mdContent = Buffer.from(`
# Sentinel Incident Response Playbook
## Section 1: Triage Guidelines
When a critical SSH brute-force alert fires, immediately isolate the affected host.
1. Check authentication logs in /var/log/auth.log.
2. Verify rate-limiting firewall rules on port 22.
3. Notify the on-call Security Operations Lead.

## Section 2: Containment
Execute automated quarantine scripts to terminate unauthorized sessions.
      `);

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', mdContent, 'incident_playbook.md')
        .field('title', 'Sentinel Incident Response Playbook');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.source.id).toBeDefined();
      expect(res.body.source.title).toBe('Sentinel Incident Response Playbook');
      expect(res.body.source.filename).toBe('incident_playbook.md');
      expect(res.body.source.status).toBe('completed');
      expect(res.body.source.chunkCount).toBeGreaterThan(0);
      expect(res.body.source.totalTokens).toBeGreaterThan(0);
      expect(res.body.source.sha256).toBeDefined();

      uploadedMarkdownDocId = res.body.source.id;
    }, 25000);

    it('successfully uploads and extracts JSON specifications (.json)', async () => {
      const jsonContent = Buffer.from(
        JSON.stringify({
          api: 'NomaanOS Core Telemetry',
          version: '2.4.0',
          endpoints: [
            { path: '/v1/telemetry/events', method: 'POST', auth: 'bearer' },
            { path: '/v1/telemetry/metrics', method: 'GET', auth: 'bearer' },
          ],
          security: {
            tlsRequired: true,
            minTlsVersion: '1.3',
          },
        })
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', jsonContent, 'telemetry_spec.json')
        .field('title', 'Core Telemetry OpenAPI Spec');

      expect(res.status).toBe(201);
      expect(res.body.source.title).toBe('Core Telemetry OpenAPI Spec');
      expect(res.body.source.mimeType).toBe('application/json');
      expect(res.body.source.status).toBe('completed');

      uploadedJsonDocId = res.body.source.id;
    });

    it('successfully uploads valid PDF document with %PDF- signature', async () => {
      const pdfMockContent = Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\nxref\n0 4\n0000000000 65535 f \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF'
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', pdfMockContent, 'security_whitepaper.pdf')
        .field('title', 'Enterprise Security Architecture Whitepaper');

      expect(res.status).toBe(201);
      expect(res.body.source.mimeType).toBe('application/pdf');
      expect(['completed', 'completed_with_warnings']).toContain(res.body.source.status);
    });

    it('captures processing warnings on HTML with stripped script tags', async () => {
      const htmlContent = Buffer.from(
        '<!DOCTYPE html><html><head><title>SaaS Deployment Guide</title><script>stealCredentials();</script></head><body><h1>SaaS Deployment Runbook</h1><p>Steps to deploy containers.</p></body></html>'
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', htmlContent, 'deployment.html');

      expect(res.status).toBe(201);
      expect(res.body.source.status).toBe('completed_with_warnings');
      expect(res.body.source.warnings.some((w: any) => w.code === 'STRIPPED_SCRIPTS')).toBe(true);
    });

    it('records failed document processing status on malformed syntax without crashing', async () => {
      const malformedJson = Buffer.from('{"broken": "json unclosed');
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', malformedJson, 'invalid_spec.json');

      expect(res.status).toBe(201);
      expect(res.body.source.status).toBe('failed');
      expect(res.body.source.errorMessage).toBeDefined();
    });
  });

  // ===========================================================================
  // Task 6: Document Metadata, Chunks, and Versioning Inspections
  // ===========================================================================
  describe('4. Document Metadata, Structure Chunks & Version History', () => {
    let sourceId: string;

    beforeAll(async () => {
      const content = Buffer.from('# Architecture\n\nHigh-availability cluster config.\n\n# Failover\n\nAutomated leader election.');
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', content, 'cluster_docs.md');
      sourceId = uploadRes.body.source.id;
    });

    it('lists document sources filtered by knowledge space', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources?knowledgeSpaceId=${spaceAId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('X-Workspace-Id', workspaceAId);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.sources)).toBe(true);
      expect(res.body.sources.length).toBeGreaterThanOrEqual(1);

      const doc = res.body.sources.find((d: any) => d.id === sourceId);
      expect(doc).toBeDefined();
      expect(doc.knowledgeSpaceId).toBe(spaceAId);
      expect(doc.fileSizeBytes).toBeGreaterThan(0);
    });

    it('retrieves detailed document source with extracted text preview', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources/${sourceId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.source.id).toBe(sourceId);
      expect(res.body.source.extractedTextPreview).toContain('High-availability');
      expect(Array.isArray(res.body.source.versions)).toBe(true);
    });

    it('retrieves structure-aware chunks with token counts and section paths', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources/${sourceId}/chunks`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.chunks)).toBe(true);
      expect(res.body.chunks.length).toBeGreaterThan(0);

      const firstChunk = res.body.chunks[0];
      expect(firstChunk.sourceId || firstChunk.source_id).toBe(sourceId);
      expect(firstChunk.tokenCount || firstChunk.token_count).toBeGreaterThan(0);
      expect(firstChunk.content).toBeDefined();
    });

    it('retrieves version history for the document source', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources/${sourceId}/versions`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.versions)).toBe(true);
      expect(res.body.versions.length).toBeGreaterThanOrEqual(1);
      expect(res.body.versions[0].versionNumber).toBe(1);
      expect(res.body.versions[0].isCurrent).toBe(true);
    });
  });

  // ===========================================================================
  // Task 7: Reprocessing / Synchronization & Ingestion Jobs
  // ===========================================================================
  describe('5. Asynchronous Synchronization & Ingestion Job Tracking', () => {
    let sourceId: string;

    beforeAll(async () => {
      const content = Buffer.from('Sync test document contents.');
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', content, 'sync_test.txt');
      sourceId = res.body.source.id;
    });

    it('enqueues an asynchronous background sync job for a document source (202 Accepted)', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-sources/${sourceId}/sync`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('queued');
      expect(res.body.job).toBeDefined();
      expect(res.body.job.sourceId).toBe(sourceId);
    });

    it('lists ingestion jobs scoped to the workspace and document source', async () => {
      const res = await request(app)
        .get(`/api/v1/ingestion-jobs?sourceId=${sourceId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('X-Workspace-Id', workspaceAId);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.jobs)).toBe(true);
      expect(res.body.jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // Task 8 & 9: Security, Multi-Tenant Isolation & RBAC
  // ===========================================================================
  describe('6. Security, Multi-Tenant Isolation & Role Authorization (RBAC)', () => {
    let alphaDocId: string;

    beforeAll(async () => {
      const content = Buffer.from('Confidential Alpha Corporate Secrets');
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', content, 'alpha_secrets.txt');
      alphaDocId = res.body.source.id;
    });

    it('prevents cross-project upload (User B uploading to Space A -> 404/403)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userBToken}`)
        .attach('file', Buffer.from('Intrusion attempt'), 'intruder.txt');

      expect([403, 404]).toContain(res.status);
    });

    it('prevents cross-project document reading (User B accessing Space A document -> 404)', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources/${alphaDocId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('prevents cross-project document deletion (User B deleting Space A document -> 404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/knowledge-sources/${alphaDocId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it('enforces RBAC: workspace viewer role cannot upload document sources (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .attach('file', Buffer.from('Viewer upload attempt'), 'viewer.txt');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/analyst/i);
    });

    it('allows workspace Admin to delete document source and cascades chunk cleanup', async () => {
      const createRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('Temporary cleanup doc'), 'to_delete.txt');
      const tempId = createRes.body.source.id;

      // Delete document
      const delRes = await request(app)
        .delete(`/api/v1/knowledge-sources/${tempId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.status).toBe('ok');

      // Verify source is gone
      const checkRes = await request(app)
        .get(`/api/v1/knowledge-sources/${tempId}`)
        .set('Authorization', `Bearer ${userAToken}`);
      expect(checkRes.status).toBe(404);

      // Verify chunks were cascaded
      const chunkCountRes = await pool.query(
        'SELECT count(*) FROM document_chunks WHERE source_id = $1;',
        [tempId]
      );
      expect(parseInt(chunkCountRes.rows[0].count, 10)).toBe(0);
    });
  });
});
