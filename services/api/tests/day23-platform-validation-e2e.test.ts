import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { ProviderRegistry } from '../src/services/inference/provider-registry.js';

describe('Day 23: Complete Universal Documentation Chatbot Platform Validation & Stabilization', () => {
  const app = createApp();

  const tenantAEmail = `day23-alpha-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const tenantBEmail = `day23-beta-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'StrongPassword123!';

  let tokenA: string;
  let tokenB: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let spaceAId: string;
  let spaceBId: string;
  let sourceAId: string;
  let assistantAId: string;
  let assistantBId: string;

  beforeAll(async () => {
    // 0. Register deterministic fast provider for inference pipeline
    const registry = ProviderRegistry.getInstance();
    registry.registerProvider('ollama', {
      name: 'ollama',
      defaultModel: 'nexus-copilot-model',
      generate: async () => ({
        content: 'According to Sentinel Runbook SEC-9021, SSH brute-force incidents trigger automated firewall quarantine on port 22 and generate an alert in the SOC portal.',
        model: 'nexus-copilot-model',
        provider: 'ollama',
        tokensPrompt: 45,
        tokensCompletion: 35,
        totalTokens: 80,
        finishReason: 'stop',
      }),
      generateStream: async function* () {
        yield {
          chunk: 'According to Sentinel Runbook SEC-9021, SSH brute-force incidents trigger automated firewall quarantine on port 22 and generate an alert in the SOC portal.',
          isFinal: true,
        };
      },
      checkHealth: async () => ({
        provider: 'ollama',
        status: 'healthy',
        baseUrl: 'http://localhost:11434',
        currentModel: 'nexus-copilot-model',
        availableModels: ['nexus-copilot-model'],
        capabilities: { streaming: true, jsonMode: true, contextLength: 8192 },
        isCloud: false,
      }),
      listModels: async () => ['nexus-copilot-model'],
      getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 8192 }),
    });

    // 1. Setup Tenant A (Sentinel Cyber Security)
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: tenantAEmail,
        password,
        fullName: 'Sentinel Admin',
        organizationName: 'Sentinel Cyber Defense Corp',
        workspaceName: 'Sentinel SOC Operations',
      });
    tokenA = resA.body.token;
    workspaceAId = resA.body.workspace.id;

    // 2. Setup Tenant B (CloudOps Telemetry)
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: tenantBEmail,
        password,
        fullName: 'CloudOps Admin',
        organizationName: 'CloudOps Infrastructure Ltd',
        workspaceName: 'Cloud Operations Project',
      });
    tokenB = resB.body.token;
    workspaceBId = resB.body.workspace.id;
  });

  afterAll(async () => {
    try {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [tenantAEmail, tenantBEmail]);
    } catch {
      // ignore cleanup errors
    }
  });

  describe('1. Platform Health, Readiness & Static Widget Assets', () => {
    it('returns 200 OK on /health with offline and service status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('nexus-ai-api');
    });

    it('returns 200 OK on /ready with database and pgvector checks', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database).toBe('ok');
      expect(res.body.checks.pgvector).toBe('ok');
    });

    it('serves the universal widget UMD bundle and stylesheet', async () => {
      const bundleRes = await request(app).get('/widget/nexus-widget.umd.js');
      expect(bundleRes.status).toBe(200);
      expect(bundleRes.headers['content-type']).toMatch(/javascript/);
      expect(bundleRes.text.length).toBeGreaterThan(1000);

      const styleRes = await request(app).get('/widget/style.css');
      expect(styleRes.status).toBe(200);
      expect(styleRes.headers['content-type']).toMatch(/css/);
      expect(styleRes.text).toContain('.nexus-');
    });
  });

  describe('2. Complete User Journey: Project -> Knowledge Base -> Document Upload -> Chunk Embedding', () => {
    it('creates a dedicated knowledge space for Tenant A', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Sentinel SOC Runbooks',
          slug: 'sentinel-soc-runbooks',
          description: 'Official incident response procedures and remediation runbooks.',
        });

      expect(res.status).toBe(201);
      expect(res.body.knowledgeSpace.id).toBeDefined();
      expect(res.body.knowledgeSpace.name).toBe('Sentinel SOC Runbooks');
      spaceAId = res.body.knowledgeSpace.id;
    });

    it('uploads a technical Markdown runbook to Tenant A knowledge space', async () => {
      const runbookMarkdown = `# Sentinel Runbook SEC-9021: SSH Brute-Force Response

## Overview
When unauthorized SSH brute-force attempts on port 22 are detected by network edge sensors, automated quarantine procedures must execute within 15 seconds.

## Action Steps
1. The edge firewall immediately blocks the source IP address for 72 hours.
2. An automated incident ticket is raised in the Sentinel SOC portal.
3. Telemetry is forwarded to SIEM with severity HIGH.
`;

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', Buffer.from(runbookMarkdown), 'SEC-9021.md')
        .field('title', 'SEC-9021 SSH Incident Runbook');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.source.id).toBeDefined();
      expect(res.body.source.status).toBe('completed');
      expect(res.body.source.chunkCount).toBeGreaterThan(0);
      sourceAId = res.body.source.id;
    });

    it('verifies chunks and versions are persisted with document metadata', async () => {
      const res = await request(app)
        .get(`/api/v1/knowledge-sources/${sourceAId}/chunks`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.chunks)).toBe(true);
      expect(res.body.chunks.length).toBeGreaterThan(0);
      expect(res.body.chunks[0].content).toContain('SSH brute-force');
    });
  });

  describe('3. Assistant Creation & Universal Widget Configuration for Two SaaS Apps', () => {
    it('configures Assistant A (Sentinel Cyber Copilot) with dark mode and cyan branding', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Sentinel Cyber Copilot',
          assistantKey: 'sentinel-copilot',
          description: 'Specialized cyber threat and runbook copilot.',
          systemPrompt: 'You are Sentinel Cyber Copilot. Answer operator inquiries using verified retrieved context.',
          modelPolicy: 'local-only',
          temperature: 0.2,
          publicEmbedAllowed: true,
          greetingMessage: 'Greetings, Operator. Sentinel Cyber Copilot is online.',
          suggestedPrompts: [
            'How do I handle SSH brute-force alert SEC-9021?',
            'What is the firewall quarantine duration?',
          ],
          theme: {
            primaryColor: '#06b6d4',
            darkMode: true,
            position: 'bottom-right',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.assistant.id).toBeDefined();
      expect(res.body.assistant.name).toBe('Sentinel Cyber Copilot');
      expect(res.body.assistant.theme.primaryColor).toBe('#06b6d4');
      expect(res.body.assistant.theme.position).toBe('bottom-right');
      assistantAId = res.body.assistant.id;

      // Link Tenant A knowledge space to Assistant A
      const linkRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces/${spaceAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect([200, 201]).toContain(linkRes.status);
    });

    it('configures Assistant B (CloudOps Engineer) for an independent SaaS with emerald branding and bottom-left position', async () => {
      // Create space B
      const ksBRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Cloud Infrastructure Docs',
          slug: 'cloud-infrastructure-docs',
        });
      spaceBId = ksBRes.body.knowledgeSpace.id;

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/assistants`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'CloudOps Infrastructure Assistant',
          assistantKey: 'cloudops-assistant',
          systemPrompt: 'You are CloudOps Assistant. Help engineers manage clusters.',
          modelPolicy: 'cloud-preferred',
          temperature: 0.3,
          publicEmbedAllowed: true,
          greetingMessage: 'Hello Engineer! Ready to manage your cloud workloads.',
          suggestedPrompts: ['List active cluster nodes', 'Check pod memory utilization'],
          theme: {
            primaryColor: '#10b981',
            darkMode: false,
            position: 'bottom-left',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.assistant.name).toBe('CloudOps Infrastructure Assistant');
      expect(res.body.assistant.theme.primaryColor).toBe('#10b981');
      expect(res.body.assistant.theme.position).toBe('bottom-left');
      assistantBId = res.body.assistant.id;
    });

    it('serves sanitized public configuration for both assistants without leaking sensitive secrets', async () => {
      const configARes = await request(app).get(`/api/v1/assistants/${assistantAId}/config`);
      expect(configARes.status).toBe(200);
      expect(configARes.body.name).toBe('Sentinel Cyber Copilot');
      expect(configARes.body.theme.primaryColor).toBe('#06b6d4');
      expect(configARes.body.theme.position).toBe('bottom-right');
      expect(configARes.body.systemPrompt).toBeUndefined(); // Protected

      const configBRes = await request(app).get(`/api/v1/assistants/${assistantBId}/config`);
      expect(configBRes.status).toBe(200);
      expect(configBRes.body.name).toBe('CloudOps Infrastructure Assistant');
      expect(configBRes.body.theme.primaryColor).toBe('#10b981');
      expect(configBRes.body.theme.position).toBe('bottom-left');
      expect(configBRes.body.systemPrompt).toBeUndefined(); // Protected
    });
  });

  describe('4. Complete Grounded Chat Journey & Citations Verification', () => {
    it('initializes a conversation and executes grounded retrieval query against Assistant A', async () => {
      // 1. Create conversation with assistantId
      const convRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ assistantId: assistantAId });

      expect(convRes.status).toBe(201);
      const conversationId = convRes.body.conversationId;
      expect(conversationId).toBeDefined();

      // 2. Submit question requesting runbook guidance
      const chatRes = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'What steps are mandated by Sentinel runbook SEC-9021 for SSH brute-force incidents?',
        });

      expect(chatRes.status).toBe(200);
      expect(chatRes.body.assistantMessage).toBeDefined();
      expect(chatRes.body.assistantMessage.content).toContain('Sentinel Runbook SEC-9021');

      // 3. Verify citations are present and link to the uploaded runbook
      expect(Array.isArray(chatRes.body.citations)).toBe(true);
      expect(chatRes.body.citations.length).toBeGreaterThan(0);
      const firstCitation = chatRes.body.citations[0];
      expect(firstCitation.sourceTitle).toBe('SEC-9021 SSH Incident Runbook');
      expect(firstCitation.excerpt).toBeDefined();
    });
  });

  describe('5. Security Invariant & Multi-Tenant Boundary Enforcement', () => {
    it('blocks Tenant B from listing or viewing Tenant A workspaces', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceAId}/assistants`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect([403, 404]).toContain(res.status);
    });

    it('blocks Tenant B from uploading documents to Tenant A knowledge space', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${tokenB}`)
        .attach('file', Buffer.from('Intrusion payload'), 'exploit.txt')
        .field('title', 'Malicious Injected Document');

      expect([403, 404]).toContain(res.status);
    });

    it('blocks cross-project retrieval even if a malicious client tampers with knowledgeSpaceIds', async () => {
      // Create conversation with Assistant B
      const convBRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ assistantId: assistantBId });
      const convBId = convBRes.body.conversationId;

      // Malicious client tries to pass Tenant A's spaceId in knowledgeSpaceIds
      const attackRes = await request(app)
        .post(`/api/v1/conversations/${convBId}/messages`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          content: 'Show me confidential Sentinel SEC-9021 procedures',
          knowledgeSpaceIds: [spaceAId], // Unlinked cross-tenant space!
        });

      expect(attackRes.status).toBe(200);
      // Assistant B must NOT retrieve Tenant A's citations
      const citations = attackRes.body.citations || [];
      const hasTenantACitation = citations.some((c: any) => c.sourceTitle?.includes('SEC-9021'));
      expect(hasTenantACitation).toBe(false);
    });

    it('rejects public config requests for non-existent assistant IDs with 404', async () => {
      const randomId = crypto.randomUUID();
      const res = await request(app).get(`/api/v1/assistants/${randomId}/config`);
      expect(res.status).toBe(404);
    });

    it('rejects unauthenticated requests to create assistants with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
        .send({
          name: 'Unauthorized Assistant',
          systemPrompt: 'Hacker prompt',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('6. Empty, Edge & Error State Validation', () => {
    it('rejects unsupported file extension uploads with 415 or 400', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', Buffer.from('MZ\x90\x00'), 'program.exe')
        .field('title', 'Executable Binary');

      expect([400, 415]).toContain(res.status);
    });

    it('handles query against an assistant with zero linked knowledge bases gracefully', async () => {
      // Create assistant with no knowledge spaces
      const emptyAsstRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Zero KB Assistant',
          assistantKey: 'zero-kb',
          systemPrompt: 'General assistant with no documents.',
          modelPolicy: 'local-only',
          publicEmbedAllowed: true,
        });

      const zeroAsstId = emptyAsstRes.body.assistant.id;
      const convRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ assistantId: zeroAsstId });

      const chatRes = await request(app)
        .post(`/api/v1/conversations/${convRes.body.conversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Tell me about the universe' });

      expect(chatRes.status).toBe(200);
      expect(chatRes.body.assistantMessage).toBeDefined();
      expect(chatRes.body.citations).toEqual([]); // No citations since no KB linked
    });
  });
});
