/**
 * NomaanOS Nexus AI - Day 10 Integration Tests
 * Keyword Search, Hybrid Retrieval, Reciprocal Rank Fusion (RRF), and Metadata Filtering
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';

describe('Day 10 — Keyword Search and Hybrid Retrieval', () => {
  const app = createApp();

  const userAEmail = `day10-user-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day10-user-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'TestPassword123!';

  let userAToken: string;
  let userBToken: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let spaceAId: string;
  let spaceBId: string;
  let sourceAId: string;
  let sourceBId: string;

  beforeAll(async () => {
    // 1. Register User A (Workspace A)
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 10 Lead Architect',
        organizationName: 'Hybrid Systems Corp',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B (Workspace B - Intruder)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Day 10 Intruder B',
        organizationName: 'Cross Tenant Systems',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create Knowledge Spaces
    const spaceARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Technical Incident Runbooks',
        slug: `tech-runbooks-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Kubernetes and API troubleshooting guides',
      });
    spaceAId = spaceARes.body.knowledgeSpace.id;

    const spaceBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Workspace B Isolated Space',
        slug: `isolated-b-${crypto.randomUUID().slice(0, 6)}`,
      });
    spaceBId = spaceBRes.body.knowledgeSpace.id;

    // 4. Ingest Technical Document Source 1 (Incident Guide with Exact Error Codes & Paths)
    const doc1Content = `# Sentinel SOC Incident & API Response Guide

## Authentication Failures & Token Expiration
When clients receive HTTP 401 with error code ERR_AUTH_EXPIRED, the JWT access token has passed its expiry.
Inspect the authorization header and verify rotation at /api/v1/auth/refresh.
For login issues, test POST /api/v1/auth/login directly against the identity provider.

## Kubernetes Node Drainage and OOMKilled Errors
When pod container exit code 137 occurs, Linux cgroups terminated the process due to OOMKilled.
Isolate host cluster node node-prod-42 using:
\`\`\`bash
kubectl cordon node-prod-42
kubectl drain node-prod-42 --ignore-daemonsets
\`\`\`
Check container memory limits in the deployment manifest before uncordoning.`;

    const upload1Res = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
      .set('Authorization', `Bearer ${userAToken}`)
      .field('title', 'Sentinel Incident Response')
      .field('customMetadata', JSON.stringify({ product: 'NexusGuard', tier: 'critical' }))
      .attach('file', Buffer.from(doc1Content, 'utf-8'), 'sentinel-incident-response.md');

    expect(upload1Res.status).toBe(201);
    sourceAId = upload1Res.body.source.id;

    // 5. Ingest Document Source 2 (Database Runbook with different metadata)
    const doc2Content = `# Database Failover Runbook

## PostgreSQL Replication Lag
When replication lag exceeds 500MB, monitor pg_stat_replication.
Execute failover script:
\`\`\`bash
nexusctl db failover --cluster=prod-db-primary
\`\`\`
Verify WAL replay on replica nodes.`;

    const upload2Res = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
      .set('Authorization', `Bearer ${userAToken}`)
      .field('title', 'Database Failover Runbook')
      .field('customMetadata', JSON.stringify({ product: 'NexusData', tier: 'standard' }))
      .attach('file', Buffer.from(doc2Content, 'utf-8'), 'db-failover.md');

    expect(upload2Res.status).toBe(201);
    sourceBId = upload2Res.body.source.id;
  });

  describe('1. Full-Text Search on Exact Technical Terms & Identifiers', () => {
    it('retrieves chunks matching exact error code ERR_AUTH_EXPIRED via keyword search', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'ERR_AUTH_EXPIRED',
          searchMode: 'keyword',
          topK: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.searchMode).toBe('keyword');
      expect(res.body.results.length).toBeGreaterThan(0);

      const topResult = res.body.results[0];
      expect(topResult.content).toContain('ERR_AUTH_EXPIRED');
      expect(topResult.keywordScore).toBeGreaterThan(0.4);
      expect(topResult.similarityScore).toBeNull();
      expect(topResult.rankings.keywordRank).toBe(1);
      expect(topResult.source.title).toBe('Sentinel Incident Response');
    });

    it('retrieves chunks matching exact API path /api/v1/auth/login via keyword search', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: '/api/v1/auth/login',
          searchMode: 'keyword',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].content).toContain('/api/v1/auth/login');
    });

    it('retrieves chunks matching specific technical identifier node-prod-42', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'node-prod-42',
          searchMode: 'keyword',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].content).toContain('node-prod-42');
    });
  });

  describe('2. Retrieval Modes (Semantic, Keyword, and Hybrid)', () => {
    it('executes semantic-only search returning similarity scores and semantic rankings', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'How to handle pod memory limit eviction?',
          searchMode: 'semantic',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.searchMode).toBe('semantic');
      expect(res.body.results.length).toBeGreaterThan(0);

      const topMatch = res.body.results[0];
      expect(topMatch.similarityScore).toBeGreaterThan(0.5);
      expect(topMatch.keywordScore).toBeNull();
      expect(topMatch.rankings.semanticRank).toBe(1);
      expect(topMatch.rankings.keywordRank).toBeNull();
    });

    it('executes hybrid search combining semantic concepts and exact keywords with RRF', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'OOMKilled exit code 137 pod container memory',
          searchMode: 'hybrid',
          topK: 5,
          rrfK: 60,
        });

      expect(res.status).toBe(200);
      expect(res.body.searchMode).toBe('hybrid');
      expect(res.body.results.length).toBeGreaterThan(0);

      const topResult = res.body.results[0];
      // Since this chunk matched both semantic and keyword queries, it should have both scores
      expect(topResult.similarityScore).not.toBeNull();
      expect(topResult.keywordScore).not.toBeNull();
      expect(topResult.rankings.semanticRank).toBeDefined();
      expect(topResult.rankings.keywordRank).toBeDefined();

      // Combined RRF score for rank 1 in both is: 1/(60+1) + 1/(60+1) = 2/61 ≈ 0.032787
      expect(topResult.rrfScore).toBeGreaterThan(0.025);
    });

    it('guarantees zero duplicate chunks in hybrid retrieval results', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'Kubernetes OOMKilled node-prod-42',
          searchMode: 'hybrid',
          topK: 10,
        });

      expect(res.status).toBe(200);
      const chunkIds = res.body.results.map((r: any) => r.chunkId);
      const uniqueChunkIds = new Set(chunkIds);
      expect(uniqueChunkIds.size).toBe(chunkIds.length);
    });
  });

  describe('3. Metadata and Product Filters', () => {
    it('filters results strictly by product name (NexusGuard vs NexusData)', async () => {
      // 1. Query matching both documents, but filtered to product 'NexusData'
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'failover script runbook',
          searchMode: 'hybrid',
          filters: {
            product: 'NexusData',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      for (const item of res.body.results) {
        expect(item.source.title).toBe('Database Failover Runbook');
      }
    });

    it('filters results strictly by sourceId', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'failover',
          searchMode: 'hybrid',
          filters: {
            sourceId: sourceAId, // Searching for failover in Document 1 which has no DB failover
          },
        });

      expect(res.status).toBe(200);
      // None of Document 1 chunks match or all returned belong to sourceAId
      for (const item of res.body.results) {
        expect(item.source.id).toBe(sourceAId);
      }
    });

    it('filters results by custom metadata JSON containment', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'Sentinel JWT token expiration',
          searchMode: 'hybrid',
          filters: {
            metadata: { tier: 'critical' },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      for (const item of res.body.results) {
        expect(item.source.id).toBe(sourceAId);
      }
    });
  });

  describe('4. Permissions, Tenant Isolation & Version Exclusion', () => {
    it('blocks User B from Workspace B from searching Workspace A knowledge space', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          query: 'ERR_AUTH_EXPIRED',
          searchMode: 'hybrid',
        });

      expect([403, 404]).toContain(res.status);
    });

    it('blocks User B on direct route /api/v1/knowledge-spaces/:id/search with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          query: 'ERR_AUTH_EXPIRED',
          searchMode: 'hybrid',
        });

      expect(res.status).toBe(403);
    });

    it('returns zero results when searching in empty Workspace B space', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces/${spaceBId}/search`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          query: 'ERR_AUTH_EXPIRED',
          searchMode: 'hybrid',
        });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(0);
    });

    it('excludes superseded version 1 chunks when version 2 is uploaded', async () => {
      const updatedContent = `# Sentinel SOC Incident & API Response Guide (v2)

## Authentication Protocol Upgrade
OAuth 2.1 mTLS is now enforced. Legacy ERR_AUTH_EXPIRED is replaced with RFC_TOKEN_REVOKED.
All auth endpoints now reside under /api/v2/secure/auth.`;

      const updateRes = await request(app)
        .put(`/api/v1/knowledge-sources/${sourceAId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .attach('file', Buffer.from(updatedContent, 'utf-8'), 'sentinel-incident-response-v2.md');

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.update.versionNumber).toBe(2);

      // Search for the new error code in hybrid mode
      const searchNew = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'RFC_TOKEN_REVOKED mTLS /api/v2/secure/auth',
          searchMode: 'hybrid',
        });

      expect(searchNew.status).toBe(200);
      expect(searchNew.body.results.length).toBeGreaterThan(0);
      const sourceAChunks = searchNew.body.results.filter((r: any) => r.source.id === sourceAId);
      expect(sourceAChunks.length).toBeGreaterThan(0);
      for (const item of sourceAChunks) {
        expect(item.source.versionNumber).toBe(2);
      }

      // Verify that superseded version 1 content (/api/v1/auth/refresh) is not found via keyword search
      const searchOldKeyword = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: '/api/v1/auth/refresh',
          searchMode: 'keyword',
          filters: { sourceId: sourceAId },
        });

      expect(searchOldKeyword.status).toBe(200);
      expect(searchOldKeyword.body.results).toHaveLength(0);

      // Verify that in hybrid search, any returned chunks are strictly active version 2, never superseded version 1
      const searchOldHybrid = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: '/api/v1/auth/refresh',
          searchMode: 'hybrid',
          filters: { sourceId: sourceAId },
        });

      expect(searchOldHybrid.status).toBe(200);
      for (const resItem of searchOldHybrid.body.results) {
        expect(resItem.source.versionNumber).toBe(2);
      }
    });
  });

  describe('5. Input Validation & Error Handling', () => {
    it('rejects empty query strings with 400 ValidationError', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: '',
          searchMode: 'hybrid',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('rejects invalid search mode with 400 ValidationError', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'valid query',
          searchMode: 'quantum',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });
});
