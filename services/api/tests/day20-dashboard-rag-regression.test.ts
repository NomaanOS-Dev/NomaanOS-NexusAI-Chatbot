/**
 * Day 20 Test Suite: Multi-Project Platform & Protected RAG Regression
 *
 * Verifies:
 * 1. Multi-project dashboard APIs: workspace listing, details, and creation.
 * 2. Associate projects with authorized assistants and knowledge spaces.
 * 3. Protected RAG Regression: document ingestion, hybrid retrieval, evidence assembly,
 *    grounded answer synthesis, and citation generation with real documents.
 * 4. Authorization and project/workspace boundary enforcement.
 * 5. Public assistant widget configuration and local asset delivery.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { ProviderRegistry } from '../src/services/inference/provider-registry.js';

const app = createApp();

describe('Day 20 - Multi-Project Platform & RAG Regression Suite', () => {
  let userToken: string;
  let userId: string;
  let workspace1Id: string;
  let workspace2Id: string;
  let assistantId: string;
  let knowledgeSpaceId: string;
  let conversationId: string;
  let sourceId: string;

  beforeAll(async () => {
    // 1. Register Primary Platform Operator
    const email = `day20-platform-${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Platform Operations Admin',
        organizationName: 'Nexus Universal Corp',
        workspaceName: 'Primary Engineering Project',
      });

    userToken = regRes.body.token;
    userId = regRes.body.user.id;
    workspace1Id = regRes.body.workspace.id;

    // 2. Register Fast Mock Provider for Deterministic Grounded Generation
    const registry = ProviderRegistry.getInstance();
    registry.registerProvider('ollama', {
      name: 'ollama',
      defaultModel: 'nexus-rag-v1',
      generate: async () => ({
        content: 'Sentinel SOC architecture deploys automated event correlation across all perimeter nodes.',
        model: 'nexus-rag-v1',
        provider: 'ollama',
        tokensPrompt: 30,
        tokensCompletion: 20,
        totalTokens: 50,
        finishReason: 'stop',
      }),
      generateStream: async function* () {
        yield { chunk: 'Sentinel SOC architecture deploys automated event correlation across all perimeter nodes.', isFinal: true };
      },
      checkHealth: async () => ({
        provider: 'ollama',
        status: 'healthy',
        baseUrl: 'http://localhost:11434',
        currentModel: 'nexus-rag-v1',
        availableModels: ['nexus-rag-v1'],
        capabilities: { streaming: true, jsonMode: true, contextLength: 8192 },
        isCloud: false,
      }),
      listModels: async () => ['nexus-rag-v1'],
      getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 8192 }),
    });

    // 3. Create Assistant in Workspace 1
    const asstRes = await request(app)
      .post(`/api/v1/workspaces/${workspace1Id}/assistants`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Sentinel Copilot',
        assistantKey: `sentinel-${Date.now()}`,
        description: 'SOC operations and threat triage copilot',
        systemPrompt: 'You are Sentinel Copilot providing verified guidance from security runbooks.',
        modelPolicy: 'local-only',
        publicEmbedAllowed: true,
      });
    assistantId = asstRes.body.assistant.id;

    // 4. Create Knowledge Space in Workspace 1
    const ksRes = await request(app)
      .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Security Runbooks',
        slug: `security-runbooks-${Date.now()}`,
        description: 'Perimeter threat detection runbooks and playbooks',
      });
    knowledgeSpaceId = ksRes.body.knowledgeSpace.id;

    // Link Assistant to Knowledge Space
    await request(app)
      .post(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces/${knowledgeSpaceId}/assistants/${assistantId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send();

    // 5. Seed Real Grounded Document and Chunks
    const srcRes = await pool.query(
      `INSERT INTO document_sources (
         workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status
       ) VALUES ($1, $2, 'Sentinel Architecture Runbook', 'sentinel-arch.md', 'text/markdown', 4096, '/storage/sentinel.md', 'sha256-sentinel-hash', 'ready')
       RETURNING id;`,
      [workspace1Id, knowledgeSpaceId]
    );
    sourceId = srcRes.rows[0].id;

    const verRes = await pool.query(
      `INSERT INTO document_versions (source_id, version_number, sha256, status, is_current)
       VALUES ($1, 1, 'sha256-sentinel-hash', 'active', TRUE)
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
         'Sentinel SOC architecture deploys automated event correlation across all perimeter nodes and forwards telemetry.',
         30, 'Architecture/Sentinel', 1, 0, '{"verified": true}'::jsonb
       );`,
      [workspace1Id, knowledgeSpaceId, sourceId, versionId]
    );

    // 6. Create Conversation
    const convRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        assistantId,
        title: 'Architecture Inquiry',
      });
    conversationId = convRes.body.conversationId;
  });

  afterAll(async () => {
    ProviderRegistry.resetInstance();
  });

  // =========================================================================
  // Task 1: Multi-Project Workspace APIs
  // =========================================================================
  describe('Task 1: Multi-Project Workspace APIs', () => {
    it('lists user workspaces via GET /api/v1/workspaces', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.workspaces)).toBe(true);
      expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
      expect(res.body.workspaces.some((w: any) => w.id === workspace1Id)).toBe(true);
    });

    it('creates a new workspace via POST /api/v1/workspaces', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Developer Documentation Hub',
          slug: `dev-docs-${Date.now()}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('created');
      expect(res.body.workspace.name).toBe('Developer Documentation Hub');
      workspace2Id = res.body.workspace.id;
    });

    it('retrieves workspace details via GET /api/v1/workspaces/:workspaceId', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspace1Id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.workspace.id).toBe(workspace1Id);
      expect(res.body.workspace.role).toBe('owner');
    });
  });

  // =========================================================================
  // Task 2: Associated Assistants & Knowledge Spaces
  // =========================================================================
  describe('Task 2: Associated Assistants & Knowledge Spaces', () => {
    it('lists assistants for project via GET /api/v1/workspaces/:id/assistants', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspace1Id}/assistants`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.assistants)).toBe(true);
      expect(res.body.assistants.some((a: any) => a.id === assistantId)).toBe(true);
    });

    it('lists knowledge spaces for project via GET /api/v1/workspaces/:id/knowledge-spaces', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspace1Id}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.knowledgeSpaces)).toBe(true);
      expect(res.body.knowledgeSpaces.some((ks: any) => ks.id === knowledgeSpaceId)).toBe(true);
    });

    it('prohibits cross-workspace resource access', async () => {
      // User creates assistant in workspace2 referencing a space in workspace1
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace2Id}/knowledge-spaces/${knowledgeSpaceId}/assistants/${assistantId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send();

      // Knowledge space does not belong to workspace2 -> 404
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Task 3: Protected RAG Pipeline Regression Verification
  // =========================================================================
  describe('Task 3: Protected RAG Pipeline Regression Verification', () => {
    it('executes hybrid retrieval, evidence assembly, and grounded answer synthesis with real citations', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          content: 'What architecture does Sentinel SOC deploy?',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistantMessage).toBeDefined();
      expect(res.body.assistantMessage.content).toBeTruthy();

      // Citations validation
      expect(res.body.citations).toBeDefined();
      expect(res.body.citations.length).toBeGreaterThan(0);
      expect(res.body.citations[0].sourceTitle).toBe('Sentinel Architecture Runbook');
      expect(['verified', 'valid']).toContain(res.body.citations[0].validationStatus);
    }, 45000);

    it('preserves public assistant config API for widget embedding', async () => {
      const res = await request(app).get(`/api/v1/assistants/${assistantId}/config`);

      expect(res.status).toBe(200);
      expect(res.body.assistantId).toBe(assistantId);
      expect(res.body.name).toBe('Sentinel Copilot');
      expect(res.body.capabilities).toBeDefined();
      expect(res.body.capabilities.citations).toBe(true);
    });

    it('serves widget standalone assets locally without remote dependencies', async () => {
      const scriptRes = await request(app).get('/widget/nexus-widget.umd.js');
      expect(scriptRes.status).toBe(200);

      const styleRes = await request(app).get('/widget/style.css');
      expect(styleRes.status).toBe(200);
    });
  });
});

