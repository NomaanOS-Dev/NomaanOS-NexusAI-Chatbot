/**
 * NomaanOS Nexus AI - Day 18: Disconnected & Private Air-Gapped Operation Test Suite
 *
 * Verifies:
 * 1. Offline configuration and air-gapped execution flags
 * 2. Complete disconnected Grounded RAG workflow (chat, retrieval, generation)
 * 3. Indication when live remote data is unavailable
 * 4. Zero cloud leakage invariant in disconnected mode
 * 5. Offline Knowledge Package Transfer Protocol (export, SHA-256 manifest, import, tamper rejection)
 * 6. Self-hosted widget bundle availability without CDN dependencies
 * 7. Offline system readiness API (/api/v1/offline/status)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { OfflinePackagerService } from '../src/services/offline-packager.js';
import { DeterministicLocalProvider } from '../src/services/inference/deterministic-provider.js';
import { ProviderRegistry } from '../src/services/inference/provider-registry.js';
import { synthesizeGroundedAnswerAsync } from '../src/services/grounded-generator.js';

const app = createApp();

describe('Day 18 - Complete Offline Operation & Private Deployment Suite', () => {
  let userToken: string;
  let workspaceId: string;
  let assistantId: string;
  let conversationId: string;
  let knowledgeSpaceId: string;
  let sourceId: string;

  beforeAll(async () => {
    // 1. Register test user
    const email = `day18-offline-${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Air-Gapped Security Officer',
        organizationName: 'Nexus Isolated Network Enclave',
      });

    userToken = regRes.body.token;
    workspaceId = regRes.body.workspace.id;

    // 2. Create Assistant configured with local-only model policy
    const asstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/assistants`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Nexus Isolated Guard',
        assistantKey: `offline-guard-${Date.now()}`,
        description: 'Air-gapped security copilot',
        systemPrompt: 'You are Nexus Isolated Guard running strictly on disconnected hardware.',
        modelPolicy: 'local-only',
        publicEmbedAllowed: true,
      });
    assistantId = asstRes.body.assistant.id;

    // 3. Create Knowledge Space
    const ksRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Classified Runbooks',
        slug: `classified-runbooks-${Date.now()}`,
      });
    knowledgeSpaceId = ksRes.body.knowledgeSpace.id;

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces/${knowledgeSpaceId}/assistants/${assistantId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send();

    // 4. Seed Verified Document with Full-Text TSV and Vector
    const srcRes = await pool.query(
      `INSERT INTO document_sources (
         workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status
       ) VALUES ($1, $2, 'Air-Gap Protocol Guide', 'air-gap.md', 'text/markdown', 2048, '/storage/air-gap.md', 'sha256-airgap-hash', 'ready')
       RETURNING id;`,
      [workspaceId, knowledgeSpaceId]
    );
    sourceId = srcRes.rows[0].id;

    const verRes = await pool.query(
      `INSERT INTO document_versions (source_id, version_number, sha256, status, is_current)
       VALUES ($1, 1, 'sha256-airgap-hash', 'active', TRUE)
       RETURNING id;`,
      [sourceId]
    );
    const versionId = verRes.rows[0].id;

    await pool.query(
      `INSERT INTO document_chunks (
         workspace_id, knowledge_space_id, source_id, version_id, chunk_index, content, token_count,
         section_path, page_number, source_offset, metadata
       ) VALUES (
         $1, $2, $3, $4, 0,
         'In an air-gapped environment, optical media or flash drives transfer updates via an approved data diode protocol.',
         25, 'Security/AirGapProtocols', 1, 0, '{"offlineVerified": true}'::jsonb
       );`,
      [workspaceId, knowledgeSpaceId, sourceId, versionId]
    );

    // 5. Create Conversation
    const convRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        assistantId,
        title: 'Air-Gap Protocol Inquiry',
      });
    conversationId = convRes.body.conversationId;

    // 6. Register fast offline provider mock to avoid external Ollama latency/timeouts in test suite
    const registry = ProviderRegistry.getInstance();
    registry.registerProvider('ollama', {
      name: 'ollama',
      defaultModel: 'offline-llama3',
      generate: async () => ({
        content: 'In an air-gapped environment, optical media or flash drives transfer updates via an approved data diode protocol.',
        model: 'offline-llama3',
        provider: 'ollama',
        tokensPrompt: 25,
        tokensCompletion: 25,
        totalTokens: 50,
        finishReason: 'stop',
      }),
      generateStream: async function* () {
        yield { chunk: 'In an air-gapped environment, optical media or flash drives transfer updates via an approved data diode protocol.', isFinal: true };
      },
      checkHealth: async () => ({
        provider: 'ollama',
        status: 'healthy',
        baseUrl: 'http://localhost:11434',
        currentModel: 'offline-llama3',
        availableModels: ['offline-llama3'],
        capabilities: { streaming: true, jsonMode: true, contextLength: 8192 },
        isCloud: false,
      }),
      listModels: async () => ['offline-llama3'],
      getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 8192 }),
    });
  });

  afterAll(async () => {
    ProviderRegistry.resetInstance();
  });

  // =========================================================================
  // Task 1: Offline Configuration & Invariant Flags
  // =========================================================================
  describe('Task 1: Offline Configuration & Invariant Flags', () => {
    it('verifies offline mode and zero-cloud invariants in system config', () => {
      expect(config.offline).toBeDefined();
      expect(config.offline.enabled).toBe(true);
      expect(config.offline.remoteDataEnabled).toBe(false);

      // Verify sentence-transformers offline environment flags are set
      expect(process.env.TRANSFORMERS_OFFLINE).toBe('1');
      expect(process.env.HF_HUB_OFFLINE).toBe('1');
    });

    it('reports offline status via GET /health and GET /ready probes', async () => {
      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.offline).toBeDefined();
      expect(healthRes.body.offline.enabled).toBe(true);
      expect(healthRes.body.offline.remoteDataAvailable).toBe(false);

      const readyRes = await request(app).get('/ready');
      expect(readyRes.status).toBe(200);
      expect(readyRes.body.offline).toBeDefined();
      expect(readyRes.body.offline.enabled).toBe(true);
    });

    it('returns detailed air-gap readiness via GET /api/v1/offline/status', async () => {
      const res = await request(app).get('/api/v1/offline/status');
      expect(res.status).toBe(200);
      expect(res.body.offline).toBeDefined();
      expect(res.body.offline.offlineMode).toBe(true);
      expect(res.body.offline.airGapped).toBe(true);
      expect(res.body.offline.databaseConnected).toBe(true);
      expect(res.body.offline.vectorExtensionReady).toBe(true);
      expect(res.body.offline.remoteDataAvailable).toBe(false);
    });
  });

  // =========================================================================
  // Task 2: Disconnected Operation — Core Grounded RAG Chat
  // =========================================================================
  describe('Task 2: Disconnected Grounded RAG Generation', () => {
    it('executes grounded RAG response synthesis using purely local offline resources', async () => {
      const evidence = {
        items: [
          {
            citationIndex: 1,
            chunkId: 'chunk-airgap-01',
            sourceId,
            sourceTitle: 'Air-Gap Protocol Guide',
            filename: 'air-gap.md',
            versionNumber: 1,
            sectionPath: 'Security/AirGapProtocols',
            pageNumber: 1,
            sourceOffset: 0,
            tokenCount: 25,
            relevanceScore: 0.96,
            content:
              'In an air-gapped environment, optical media or flash drives transfer updates via an approved data diode protocol.',
            truncated: false,
          },
        ],
        totalTokens: 25,
        totalChunks: 1,
        candidateCount: 1,
        deduplicatedCount: 0,
        excludedPermissionCount: 0,
        insufficientEvidence: false,
      };

      const result = await synthesizeGroundedAnswerAsync({
        query: 'How are updates transferred in an air-gap?',
        evidenceResult: evidence,
        assistantName: 'Nexus Isolated Guard',
        providerName: 'local_deterministic',
      });

      expect(result.answer).toBeTruthy();
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations[0].sourceTitle).toBe('Air-Gap Protocol Guide');
      expect(result.modelUsed).toContain('deterministic');
    });

    it('delivers grounded answers via POST /api/v1/conversations/:id/messages with citations', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          content: 'What media transfers updates in an air-gap?',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistantMessage).toBeDefined();
      expect(typeof res.body.assistantMessage.content).toBe('string');
      expect(res.body.citations.length).toBeGreaterThan(0);
      expect(res.body.citations[0].sourceTitle).toBe('Air-Gap Protocol Guide');
    }, 30000);
  });

  // =========================================================================
  // Task 3: Indication When Live Remote Data is Unavailable
  // =========================================================================
  describe('Task 3: Live Remote Data Indication in Disconnected Mode', () => {
    it('delivers a clear offline notice when queries request live external data', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          content: 'What is the live real-time stock price of Apple right now?',
          stream: false,
        });

      expect(res.status).toBe(200);
      const content = res.body.assistantMessage.content;
      expect(content).toContain('Live remote data is unavailable in offline / air-gapped deployment mode');
      expect(content).toContain('disconnected local environment');
    });
  });

  // =========================================================================
  // Task 4: Zero Cloud Leakage Invariant
  // =========================================================================
  describe('Task 4: Zero Cloud Leakage Invariant', () => {
    it('strictly forbids any request attempting to route to cloud providers', async () => {
      const res = await request(app)
        .post('/api/v1/inference/generate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          prompt: 'Hello external cloud',
          policy: 'local-only',
          provider: 'openai',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('strictly disabled');
    });
  });

  // =========================================================================
  // Task 5: Approved Offline Knowledge Package Transfer Protocol
  // =========================================================================
  describe('Task 5: Offline Knowledge Package Transfer Protocol', () => {
    let exportedPackage: any;

    it('exports a knowledge space with documents, versions, chunks, and SHA-256 manifest', async () => {
      const packager = new OfflinePackagerService();
      const pkg = await packager.exportKnowledgePackage({
        workspaceId,
        knowledgeSpaceId,
        saveToDisk: true,
      });

      expect(pkg.manifest).toBeDefined();
      expect(pkg.manifest.packageId).toBeTruthy();
      expect(pkg.manifest.checksum).toHaveLength(64);
      expect(pkg.manifest.documentCount).toBe(1);
      expect(pkg.manifest.chunkCount).toBe(1);
      expect(pkg.documents.length).toBe(1);
      expect(pkg.documents[0].title).toBe('Air-Gap Protocol Guide');

      exportedPackage = pkg;
    });

    it('exports knowledge space via authenticated POST /api/v1/offline/export', async () => {
      const res = await request(app)
        .post('/api/v1/offline/export')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          knowledgeSpaceId,
          saveToDisk: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.manifest).toBeDefined();
      expect(res.body.manifest.checksum).toHaveLength(64);
    });

    it('imports knowledge package into another workspace with verified checksum', async () => {
      // Create destination workspace
      const destWorkspace = await pool.query(
        `INSERT INTO workspaces (organization_id, name, slug)
         VALUES ((SELECT organization_id FROM workspaces WHERE id = $1), 'Air-Gap Target Enclave', 'target-enclave-${Date.now()}')
         RETURNING id;`,
        [workspaceId]
      );
      const destWorkspaceId = destWorkspace.rows[0].id;

      const packager = new OfflinePackagerService();
      const importResult = await packager.importKnowledgePackage(exportedPackage, {
        targetWorkspaceId: destWorkspaceId,
        targetSpaceName: 'Imported Air-Gap Manuals',
      });

      expect(importResult.status).toBe('success');
      expect(importResult.verifiedChecksum).toBe(true);
      expect(importResult.importedDocuments).toBe(1);
      expect(importResult.importedChunks).toBe(1);

      // Verify documents exist in target workspace
      const checkDocs = await pool.query(
        `SELECT id, title FROM document_sources WHERE workspace_id = $1;`,
        [destWorkspaceId]
      );
      expect(checkDocs.rows.length).toBe(1);
      expect(checkDocs.rows[0].title).toBe('Air-Gap Protocol Guide');
    });

    it('rejects tampered or corrupted offline packages with checksum mismatch', async () => {
      const tamperedPackage = JSON.parse(JSON.stringify(exportedPackage));
      // Tamper with document content
      tamperedPackage.documents[0].title = 'Tampered Title Injection';

      const packager = new OfflinePackagerService();
      await expect(
        packager.importKnowledgePackage(tamperedPackage, {
          targetWorkspaceId: workspaceId,
        })
      ).rejects.toThrow(/checksum mismatch/i);
    });

    it('rejects tampered packages via POST /api/v1/offline/import with HTTP 400', async () => {
      const tamperedPackage = JSON.parse(JSON.stringify(exportedPackage));
      tamperedPackage.documents[0].chunks[0].content = 'Malicious injected content';

      const res = await request(app)
        .post('/api/v1/offline/import')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          package: tamperedPackage,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ChecksumVerificationFailed');
    });
  });

  // =========================================================================
  // Task 6: Self-Hosted Widget Assets Availability
  // =========================================================================
  describe('Task 6: Self-Hosted Widget Assets Availability', () => {
    it('serves the bundled widget bundle and stylesheet locally via Express without CDN dependencies', async () => {
      const jsRes = await request(app).get('/widget/nexus-widget.umd.js');
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers['content-type']).toContain('javascript');

      const cssRes = await request(app).get('/widget/style.css');
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers['content-type']).toContain('css');

      // Verify stylesheet uses local system fonts without external URL imports
      expect(cssRes.text).not.toContain('fonts.googleapis.com');
      expect(cssRes.text).not.toContain('https://');
    });
  });
});
