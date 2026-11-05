/**
 * Day 16 Integration Tests: Local Model Inference (Ollama & Provider-Agnostic Interface)
 *
 * Verifies:
 * 1. Provider-independent inference interface and factory registration.
 * 2. Local-only policy enforcement (preventing cloud inference leaks).
 * 3. Model health checks, availability status, and capability detection (streaming, jsonMode, context length).
 * 4. Ollama inference adapter with non-streaming and streaming generation.
 * 5. Structured JSON output enforcement (format: 'json').
 * 6. Request timeouts, resource cleanup, and AbortSignal cancellation.
 * 7. Grounded answer generation integration with retrieved evidence and conversation context.
 * 8. Full API integration with chat conversations and SSE streaming.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import {
  getInferenceProvider,
  assertLocalInferencePolicy,
  executeGroundedInference,
  OllamaInferenceProvider,
  DeterministicLocalProvider,
} from '../src/services/inference/index.js';
import {
  synthesizeGroundedAnswerAsync,
  buildGroundedPrompt,
} from '../src/services/grounded-generator.js';

const app = createApp();

describe('Day 16 - Local Model Inference', () => {
  let userToken: string;
  let workspaceId: string;
  let assistantId: string;
  let knowledgeSpaceId: string;
  let conversationId: string;

  beforeAll(async () => {
    // 1. Register test user
    const email = `day16-tester-${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Day 16 Local Inference Lead',
        organizationName: 'Nexus Local AI Org',
      });
    userToken = regRes.body.token;
    workspaceId = regRes.body.workspace.id;

    // 2. Create Assistant with local-only model policy
    const asstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/assistants`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Nexus Local Copilot',
        assistantKey: `local-copilot-${Date.now()}`,
        description: '100% offline local model assistant',
        systemPrompt: 'You are Nexus Local Copilot running on local hardware.',
        modelPolicy: 'local-only',
        publicEmbedAllowed: true,
      });
    assistantId = asstRes.body.assistant.id;

    // 3. Create Knowledge Space & Link
    const ksRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Local Operations Space',
        slug: `local-ops-${Date.now()}`,
      });
    knowledgeSpaceId = ksRes.body.knowledgeSpace.id;

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces/${knowledgeSpaceId}/assistants/${assistantId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send();

    // 4. Seed verified evidence document
    const sourceRes = await pool.query(
      `INSERT INTO document_sources (
         workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status
       ) VALUES ($1, $2, 'Local Model Deployment Guide', 'local-guide.md', 'text/markdown', 1024, '/tmp/local.md', 'sha256-day16-hash', 'ready')
       RETURNING id;`,
      [workspaceId, knowledgeSpaceId]
    );
    const sourceId = sourceRes.rows[0].id;

    const verRes = await pool.query(
      `INSERT INTO document_versions (source_id, version_number, sha256, status, is_current)
       VALUES ($1, 1, 'sha256-day16-hash', 'active', TRUE)
       RETURNING id;`,
      [sourceId]
    );
    const versionId = verRes.rows[0].id;
    await pool.query(`UPDATE document_sources SET current_version_id = $1 WHERE id = $2;`, [versionId, sourceId]);

    await pool.query(
      `INSERT INTO document_chunks (
         workspace_id, knowledge_space_id, source_id, version_id, chunk_index,
         content, section_path, page_number, is_active
       ) VALUES (
         $1, $2, $3, $4, 0,
         'Ollama local inference executes models via llama.cpp on local CPU or GPU. Streaming is enabled by default on port 11434.',
         'Architecture/LocalInference', 1, TRUE
       );`,
      [workspaceId, knowledgeSpaceId, sourceId, versionId]
    );

    // 5. Create conversation
    const convRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        assistantId,
        title: 'Local Inference Verification',
      });
    conversationId = convRes.body.conversationId;
  });

  afterAll(async () => {
    try {
      if (conversationId) {
        await pool.query(`DELETE FROM messages WHERE conversation_id = $1::uuid;`, [conversationId]);
        await pool.query(`DELETE FROM conversations WHERE id = $1::uuid;`, [conversationId]);
      }
      if (workspaceId) {
        await pool.query(`DELETE FROM document_chunks WHERE workspace_id = $1::uuid;`, [workspaceId]);
        await pool.query(`DELETE FROM document_sources WHERE workspace_id = $1::uuid;`, [workspaceId]);
        await pool.query(`DELETE FROM knowledge_spaces WHERE workspace_id = $1::uuid;`, [workspaceId]);
        await pool.query(`DELETE FROM assistants WHERE workspace_id = $1::uuid;`, [workspaceId]);
        await pool.query(`DELETE FROM workspaces WHERE id = $1::uuid;`, [workspaceId]);
      }
    } catch {}
  });

  // =========================================================================
  // Task 1 & 2: Provider-Independent Interface & Factory
  // =========================================================================
  describe('Task 1 & 2: Provider-Independent Inference Interface', () => {
    it('instantiates Ollama provider by name', () => {
      const provider = getInferenceProvider('ollama');
      expect(provider.name).toBe('ollama');
      expect(provider.defaultModel).toBeTruthy();
      expect(typeof provider.generate).toBe('function');
      expect(typeof provider.generateStream).toBe('function');
      expect(typeof provider.checkHealth).toBe('function');
    });

    it('instantiates deterministic local provider by name', () => {
      const provider = getInferenceProvider('local_deterministic');
      expect(provider.name).toBe('local_deterministic');
      expect(typeof provider.generate).toBe('function');
      expect(typeof provider.generateStream).toBe('function');
    });

    it('rejects unsupported inference providers with descriptive error', () => {
      expect(() => getInferenceProvider('unknown_provider' as any)).toThrow(
        /Unsupported inference provider/
      );
    });

    it('enforces local-only inference policy and blocks cloud providers', () => {
      expect(() => assertLocalInferencePolicy('openai')).toThrow(/strictly disabled/);
      expect(() => assertLocalInferencePolicy('anthropic')).toThrow(/strictly disabled/);
      expect(() => assertLocalInferencePolicy('gemini')).toThrow(/strictly disabled/);
      expect(() => assertLocalInferencePolicy('ollama')).not.toThrow();
      expect(() => assertLocalInferencePolicy('local_deterministic')).not.toThrow();
    });
  });

  // =========================================================================
  // Task 3 & 5: Model Health & Capabilities Reporting
  // =========================================================================
  describe('Task 3 & 5: Model Health and Capabilities Reporting', () => {
    it('returns provider health and capabilities via GET /api/v1/inference/health', async () => {
      const res = await request(app).get('/api/v1/inference/health');

      expect([200, 503]).toContain(res.status);
      expect(res.body.provider).toBeTruthy();
      expect(res.body.currentModel).toBeTruthy();
      expect(res.body.capabilities).toBeDefined();
      expect(typeof res.body.capabilities.streaming).toBe('boolean');
      expect(typeof res.body.capabilities.jsonMode).toBe('boolean');
      expect(typeof res.body.capabilities.contextLength).toBe('number');
      expect(res.body.localOnly).toBe(true);
    });

    it('discovers available local models via GET /api/v1/inference/models', async () => {
      const res = await request(app).get('/api/v1/inference/models');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.models)).toBe(true);
    });

    it('reports accurate capabilities for deterministic provider', async () => {
      const provider = new DeterministicLocalProvider('test-model');
      const health = await provider.checkHealth();

      expect(health.status).toBe('ready');
      expect(health.capabilities.streaming).toBe(true);
      expect(health.capabilities.jsonMode).toBe(true);
      expect(health.capabilities.contextLength).toBe(8192);
    });
  });

  // =========================================================================
  // Task 4 & 6: Timeouts, Cancellation, and Streaming
  // =========================================================================
  describe('Task 4 & 6: Streaming Generation, Timeouts & Cancellation', () => {
    it('streams generated tokens incrementally via callback', async () => {
      const provider = new DeterministicLocalProvider();
      const chunks: string[] = [];

      const response = await provider.generateStream(
        {
          prompt: 'Explain local inference streaming',
        },
        (delta) => {
          chunks.push(delta);
        }
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(response.content).toBe(chunks.join(''));
      expect(response.finishReason).toBe('stop');
    });

    it('safely cancels streaming generation when AbortSignal is triggered', async () => {
      const provider = new DeterministicLocalProvider();
      const controller = new AbortController();

      // Trigger abort immediately
      controller.abort();

      const response = await provider.generateStream(
        {
          prompt: 'This request will be aborted',
          signal: controller.signal,
        },
        () => {}
      );

      expect(response.finishReason).toBe('cancelled');
    });

    it('handles request timeout on unreachable endpoint safely', async () => {
      // Connect to unreachable port with 100ms timeout
      const unreachableProvider = new OllamaInferenceProvider({
        baseUrl: 'http://127.0.0.1:59999',
        timeoutMs: 150,
      });

      await expect(
        unreachableProvider.generate({
          prompt: 'Hello unreachable daemon',
        })
      ).rejects.toThrow(/unreachable|timed out/);
    });

    it('formats clear error message when model is not installed', async () => {
      const provider = new OllamaInferenceProvider({
        baseUrl: config.inference.ollamaBaseUrl,
        defaultModel: 'nonexistent-model-xyz-99999',
        timeoutMs: 3000,
      });

      // If Ollama daemon is active, verify 404 error formatting
      const health = await provider.checkHealth();
      if (health.status === 'ready' || health.status === 'model_not_found') {
        await expect(
          provider.generate({
            prompt: 'Test nonexistent model',
            model: 'nonexistent-model-xyz-99999',
          })
        ).rejects.toThrow(/not found/i);
      }
    });
  });

  // =========================================================================
  // Task 6: Structured Output & JSON Grammar Mode
  // =========================================================================
  describe('Task 6: Structured JSON Generation Mode', () => {
    it('generates valid structured JSON when format is set to json', async () => {
      const provider = new DeterministicLocalProvider();
      const response = await provider.generate({
        prompt: 'Generate an incident triage report',
        format: 'json',
      });

      expect(response.content).toBeTruthy();
      const parsed = JSON.parse(response.content);
      expect(parsed.status).toBe('completed');
    });
  });

  // =========================================================================
  // Task 8: Grounded RAG Generation Integration
  // =========================================================================
  describe('Task 8: Grounded Answer Synthesis & Conversations Integration', () => {
    it('executes grounded inference passing evidence tags and context safely', async () => {
      const evidence = {
        items: [
          {
            citationIndex: 1,
            chunkId: 'chunk-day16-01',
            sourceId: 'source-day16-01',
            sourceTitle: 'Local Model Deployment Guide',
            filename: 'local-guide.md',
            versionNumber: 1,
            sectionPath: 'Architecture/LocalInference',
            pageNumber: 1,
            sourceOffset: 0,
            tokenCount: 25,
            relevanceScore: 0.95,
            content: 'Ollama local inference executes models via llama.cpp on local CPU or GPU on port 11434.',
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
        query: 'What port does Ollama run on?',
        evidenceResult: evidence,
        assistantName: 'Nexus Local Copilot',
        providerName: 'local_deterministic',
      });

      expect(result.answer).toBeTruthy();
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations[0].sourceTitle).toBe('Local Model Deployment Guide');
      expect(result.prompt.userPrompt).toContain('<untrusted_evidence>');
    });

    it('delivers grounded responses through POST /api/v1/conversations/:id/messages', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          content: 'What port does local Ollama use?',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistantMessage).toBeDefined();
      expect(typeof res.body.assistantMessage.content).toBe('string');
      expect(res.body.citations.length).toBeGreaterThan(0);
    }, 90000);

    it('rejects external cloud model requests via direct generate endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/inference/generate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          prompt: 'Hello',
          provider: 'openai',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('strictly disabled');
    });
  });
});
