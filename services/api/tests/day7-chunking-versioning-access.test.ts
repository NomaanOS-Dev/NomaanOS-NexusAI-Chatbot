import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';

describe('Day 7: Chunking, Metadata, Versioning, and Access Policies', () => {
  const app = createApp();

  const userAEmail = `day7-user-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day7-user-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
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
    // 1. Register User A in Workspace A
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 7 Engineer A',
        organizationName: 'Alpha Nexus Org',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B in Workspace B
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Day 7 Engineer B',
        organizationName: 'Beta Security Org',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create Knowledge Space A
    const spaceARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha Core Docs',
        slug: `alpha-core-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Core architecture and runbooks',
      });
    spaceAId = spaceARes.body.knowledgeSpace.id;

    // 4. Create Knowledge Space B
    const spaceBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Restricted Docs',
        slug: `beta-docs-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Confidential security specs',
      });
    spaceBId = spaceBRes.body.knowledgeSpace.id;

    // 5. Create Assistant A
    const asstARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha Agent',
        assistantKey: `alpha-agent-${crypto.randomUUID().slice(0, 6)}`,
        systemPrompt: 'Alpha operations assistant.',
      });
    assistantAId = asstARes.body.assistant.id;

    // 6. Create Assistant B
    const asstBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/assistants`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Agent',
        assistantKey: `beta-agent-${crypto.randomUUID().slice(0, 6)}`,
        systemPrompt: 'Beta operations assistant.',
      });
    assistantBId = asstBRes.body.assistant.id;
  });

  afterAll(async () => {
    if (workspaceAId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceAId]);
    }
    if (workspaceBId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceBId]);
    }
  });

  let createdSourceId: string;
  let initialVersionId: string;

  describe('1. Document Upload with Structure-Aware Chunking & Version 1 Creation', () => {
    it('should upload a structured Markdown document and generate versioned, hashed chunks', async () => {
      const docContent = `# Incident Response Playbook

## Detection and Triage
When an alert fires in Sentinel SOC, verify the incident telemetry.
Inspect firewall logs and egress traffic spikes before escalating to Level 2.

## Containment Procedures
Isolate affected host containers immediately.
Revoke OAuth refresh tokens and rotate database credentials within 15 minutes.

\`\`\`bash
kubectl cordon node-prod-42
kubectl drain node-prod-42 --ignore-daemonsets
\`\`\`

## Post-Incident Reporting
Draft an RCA within 24 hours. Submit postmortem analysis to the SecOps steering committee.`;

      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${userAToken}`)
        .field('title', 'SOC Incident Playbook')
        .field('assistantId', assistantAId)
        .attach('file', Buffer.from(docContent, 'utf-8'), 'incident-playbook.md');

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.status).toBe('ok');
      expect(uploadRes.body.source.id).toBeDefined();
      expect(uploadRes.body.source.versionId).toBeDefined();
      expect(uploadRes.body.source.chunkCount).toBeGreaterThanOrEqual(1);

      createdSourceId = uploadRes.body.source.id;
      initialVersionId = uploadRes.body.source.versionId;
    }, 25000);

    it('should retrieve structure-aware chunks linked to version 1 with section paths and hashes', async () => {
      const chunksRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/chunks`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(chunksRes.status).toBe(200);
      expect(chunksRes.body.chunks).toBeInstanceOf(Array);
      expect(chunksRes.body.chunks.length).toBeGreaterThan(0);
      expect(chunksRes.body.total).toBe(chunksRes.body.chunks.length);

      const firstChunk = chunksRes.body.chunks[0];
      expect(firstChunk.sourceId).toBe(createdSourceId);
      expect(firstChunk.versionId).toBe(initialVersionId);
      expect(firstChunk.workspaceId).toBe(workspaceAId);
      expect(firstChunk.knowledgeSpaceId).toBe(spaceAId);
      expect(firstChunk.isActive).toBe(true);
      expect(firstChunk.chunkHash).toBeDefined();
      expect(firstChunk.chunkHash.length).toBe(64); // SHA-256 hex length
      expect(firstChunk.chunkIndex).toBe(0);

      // Verify at least one chunk captures structured section headings
      const sectionPaths = chunksRes.body.chunks.map((c: any) => c.sectionPath).filter(Boolean);
      expect(sectionPaths.length).toBeGreaterThan(0);
      expect(sectionPaths.some((p: string) => p.includes('Incident Response Playbook'))).toBe(true);
    });

    it('should list document versions showing version 1 as active and current', async () => {
      const versionsRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/versions`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(versionsRes.status).toBe(200);
      expect(versionsRes.body.versions).toHaveLength(1);

      const v1 = versionsRes.body.versions[0];
      expect(v1.id).toBe(initialVersionId);
      expect(v1.versionNumber).toBe(1);
      expect(v1.status).toBe('active');
      expect(v1.isCurrent).toBe(true);
      expect(v1.chunkCount).toBeGreaterThan(0);
      expect(v1.supersedesVersionId).toBeNull();
      expect(v1.supersededByVersionId).toBeNull();
    });
  });

  describe('2. Version Supersession via Incremental Document Updates (PUT)', () => {
    let secondVersionId: string;

    it('should update the document source with new content and supersede version 1', async () => {
      const updatedDocContent = `# Incident Response Playbook (v2)

## Detection and Triage
Updated triage: Sentinel SOC now routes alerts to AI Copilot first.
Copilot auto-triages alerts against historical false positives.

## Containment Procedures
Automated network quarantine is now enabled.
Revoke OAuth refresh tokens and rotate DB credentials within 5 minutes.

\`\`\`bash
nexusctl secops isolate-host --cluster=prod-us --node=node-prod-42
\`\`\`

## Recovery and Verification
Verify cluster integrity and run vulnerability scanning before uncordoning.

## Post-Incident Reporting
All RCAs must be generated via the automated Postmortem Workspace.`;

      const updateRes = await request(app)
        .put(`/api/v1/knowledge-sources/${createdSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from(updatedDocContent, 'utf-8'), 'incident-playbook-v2.md');

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('ok');
      expect(updateRes.body.update.versionId).not.toBe(initialVersionId);

      secondVersionId = updateRes.body.update.versionId;
      expect(secondVersionId).toBeDefined();
    }, 25000);

    it('should show version 2 as active/current and version 1 as superseded', async () => {
      const versionsRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/versions`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(versionsRes.status).toBe(200);
      expect(versionsRes.body.versions).toHaveLength(2);

      const v2 = versionsRes.body.versions.find((v: any) => v.versionNumber === 2);
      const v1 = versionsRes.body.versions.find((v: any) => v.versionNumber === 1);

      expect(v2).toBeDefined();
      expect(v2.isCurrent).toBe(true);
      expect(v2.status).toBe('active');
      expect(v2.supersedesVersionId).toBe(initialVersionId);

      expect(v1).toBeDefined();
      expect(v1.isCurrent).toBe(false);
      expect(v1.status).toBe('superseded');
      expect(v1.supersededByVersionId).toBe(secondVersionId);
    });

    it('should filter chunks by activeOnly=true so superseded chunks are excluded', async () => {
      // 1. Query only active chunks (default activeOnly=true)
      const activeChunksRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/chunks?activeOnly=true`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(activeChunksRes.status).toBe(200);
      // All returned chunks must belong to version 2
      for (const chunk of activeChunksRes.body.chunks) {
        expect(chunk.versionId).toBe(secondVersionId);
        expect(chunk.isActive).toBe(true);
      }

      // 2. Query all chunks including superseded (activeOnly=false)
      const allChunksRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/chunks?activeOnly=false`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(allChunksRes.status).toBe(200);
      expect(allChunksRes.body.chunks.length).toBeGreaterThan(activeChunksRes.body.chunks.length);

      const v1Chunks = allChunksRes.body.chunks.filter((c: any) => c.versionId === initialVersionId);
      const v2Chunks = allChunksRes.body.chunks.filter((c: any) => c.versionId === secondVersionId);

      expect(v1Chunks.length).toBeGreaterThan(0);
      expect(v2Chunks.length).toBeGreaterThan(0);
      expect(v1Chunks.every((c: any) => c.isActive === false)).toBe(true);
      expect(v2Chunks.every((c: any) => c.isActive === true)).toBe(true);
    });

    it('should support querying chunks by specific versionId', async () => {
      const v1QueryRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/chunks?versionId=${initialVersionId}&activeOnly=false`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(v1QueryRes.status).toBe(200);
      expect(v1QueryRes.body.chunks.length).toBeGreaterThan(0);
      expect(v1QueryRes.body.chunks.every((c: any) => c.versionId === initialVersionId)).toBe(true);
    });
  });

  describe('3. Deduplication Policy & Idempotent Updates', () => {
    it('should return existing version without re-chunking when uploading identical content', async () => {
      const identicalDocContent = `# Incident Response Playbook (v2)

## Detection and Triage
Updated triage: Sentinel SOC now routes alerts to AI Copilot first.
Copilot auto-triages alerts against historical false positives.

## Containment Procedures
Automated network quarantine is now enabled.
Revoke OAuth refresh tokens and rotate DB credentials within 5 minutes.

\`\`\`bash
nexusctl secops isolate-host --cluster=prod-us --node=node-prod-42
\`\`\`

## Recovery and Verification
Verify cluster integrity and run vulnerability scanning before uncordoning.

## Post-Incident Reporting
All RCAs must be generated via the automated Postmortem Workspace.`;

      const dedupeRes = await request(app)
        .put(`/api/v1/knowledge-sources/${createdSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from(identicalDocContent, 'utf-8'), 'incident-playbook-v2-duplicate.md');

      expect(dedupeRes.status).toBe(200);
      expect(dedupeRes.body.update.unchanged).toBe(true);

      // Verify versions count remains exactly 2 (no duplicate version 3 created)
      const versionsRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/versions`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(versionsRes.body.versions).toHaveLength(2);
    });
  });

  describe('4. Failure Isolation & Atomic Rollback', () => {
    it('should reject invalid file types during update without corrupting existing active version', async () => {
      const invalidUpdateRes = await request(app)
        .put(`/api/v1/knowledge-sources/${createdSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from('malicious binary content', 'utf-8'), 'exploit.exe');

      expect([400, 415]).toContain(invalidUpdateRes.status);

      // Verify current version is still valid and active
      const sourceRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(sourceRes.status).toBe(200);
      expect(sourceRes.body.source.status).toBe('completed');

      // Active chunks are still intact
      const activeChunks = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/chunks`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(activeChunks.body.chunks.length).toBeGreaterThan(0);
      expect(activeChunks.body.chunks.every((c: any) => c.isActive === true)).toBe(true);
    });
  });

  describe('5. Strict Tenant & Knowledge-Space Access Isolation', () => {
    it('should reject User B (Workspace B) from viewing chunks of User A source', async () => {
      const crossChunkRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/chunks`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(crossChunkRes.status).toBe(404);
    });

    it('should reject User B (Workspace B) from viewing versions of User A source', async () => {
      const crossVersionRes = await request(app)
        .get(`/api/v1/knowledge-sources/${createdSourceId}/versions`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(crossVersionRes.status).toBe(404);
    });

    it('should reject User B (Workspace B) from updating User A source', async () => {
      const crossUpdateRes = await request(app)
        .put(`/api/v1/knowledge-sources/${createdSourceId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .attach('file', Buffer.from('# Tampered Content', 'utf-8'), 'tamper.md');

      expect(crossUpdateRes.status).toBe(404);
    });

    it('should confirm direct database records have correct tenant keys and cannot leak into cross-workspace queries', async () => {
      // Query database directly with User B's workspace ID to verify 0 chunks returned
      const leakedQuery = await pool.query(
        'SELECT * FROM document_chunks WHERE workspace_id = $1 AND source_id = $2',
        [workspaceBId, createdSourceId]
      );
      expect(leakedQuery.rows).toHaveLength(0);

      // Query database directly with User A's workspace ID and is_active = TRUE
      const activeQuery = await pool.query(
        'SELECT * FROM document_chunks WHERE workspace_id = $1 AND source_id = $2 AND is_active = TRUE',
        [workspaceAId, createdSourceId]
      );
      expect(activeQuery.rows.length).toBeGreaterThan(0);
      for (const row of activeQuery.rows) {
        expect(row.knowledge_space_id).toBe(spaceAId);
        expect(row.workspace_id).toBe(workspaceAId);
        expect(row.chunk_hash).toBeDefined();
        expect(row.chunk_hash.length).toBe(64);
      }
    });
  });
});
