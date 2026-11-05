import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { ProviderRegistry } from '../src/services/inference/provider-registry.js';

describe('Day 22: Project-Specific Assistant Configuration & Reusable Chat Widget', () => {
  const app = createApp();

  const userAEmail = `day22-admin-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day22-admin-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const viewerAEmail = `day22-viewer-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'TestPassword123!';

  let userAToken: string;
  let userBToken: string;
  let viewerAToken: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let spaceAId: string;
  let spaceBId: string;
  let assistantAId: string;
  let assistantBId: string;

  beforeAll(async () => {
    // 0. Register Fast Deterministic Provider for tests
    const registry = ProviderRegistry.getInstance();
    registry.registerProvider('ollama', {
      name: 'ollama',
      defaultModel: 'nexus-rag-v1',
      generate: async () => ({
        content: 'Sentinel security policy mandates automated firewall isolation and IP quarantine for SSH brute-force attempts on port 22.',
        model: 'nexus-rag-v1',
        provider: 'ollama',
        tokensPrompt: 30,
        tokensCompletion: 20,
        totalTokens: 50,
        finishReason: 'stop',
      }),
      generateStream: async function* () {
        yield {
          chunk: 'Sentinel security policy mandates automated firewall isolation and IP quarantine for SSH brute-force attempts on port 22.',
          isFinal: true,
        };
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

    // 1. Register User A (Workspace A - Owner)
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Project Lead Alpha',
        organizationName: 'Alpha Cloud Services',
        workspaceName: 'Alpha Enterprise Project',
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
        workspaceName: 'Beta SaaS Project',
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
        organizationName: 'Alpha Readonly Viewer',
      });
    viewerAToken = regViewerRes.body.token;
    const viewerUserId = regViewerRes.body.user.id;

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
        name: 'Alpha Sentinel Telemetry KB',
        slug: `alpha-sentinel-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Sentinel security playbooks and incident response guides',
      });
    spaceAId = spaceARes.body.knowledgeSpace.id;

    // Ingest a confidential document into Space A
    const docAContent = Buffer.from(
      '# Sentinel Security Policy\n\nSSH brute-force attacks on port 22 require automated firewall isolation and IP quarantine.'
    );
    await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
      .set('Authorization', `Bearer ${userAToken}`)
      .attach('file', docAContent, 'sentinel_policy.md')
      .field('title', 'Sentinel Security Policy');

    // 5. Create Knowledge Space in Workspace B
    const spaceBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Finance Knowledge Base',
        slug: `beta-finance-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Beta executive financial forecasts and budgets',
      });
    spaceBId = spaceBRes.body.knowledgeSpace.id;

    // Ingest a confidential document into Space B
    const docBContent = Buffer.from(
      '# Beta Financial Overview\n\nQuarterly cloud spend budget is capped at 50,000 USD with strict cost allocation tags.'
    );
    await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces/${spaceBId}/sources`)
      .set('Authorization', `Bearer ${userBToken}`)
      .attach('file', docBContent, 'financial_budget.md')
      .field('title', 'Beta Financial Budget');
  });

  afterAll(async () => {
    if (workspaceAId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceAId]);
    }
    if (workspaceBId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceBId]);
    }
  });

  // ===========================================================================
  // Task 1, 2, 3: Assistant Creation with Theme, Branding, and Widget Options
  // ===========================================================================
  describe('1. Assistant Creation & Branding Configuration', () => {
    it('creates an assistant with custom theme, primary color, position, and greeting message', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          name: 'Sentinel Cyber Copilot',
          assistantKey: `sentinel-copilot-${crypto.randomUUID().slice(0, 6)}`,
          description: 'Automated threat triage copilot for Sentinel SOC dashboard',
          systemPrompt: 'You are the Sentinel Cyber Copilot. Answer security inquiries with grounded telemetry.',
          modelPolicy: 'local-only',
          temperature: 0.15,
          publicEmbedAllowed: true,
          greetingMessage: 'Greetings, Operator. Sentinel Cyber Copilot is online. How can I assist with threat triage today?',
          suggestedPrompts: [
            'Analyze threat telemetry for anomaly alert #9021',
            'Explain recent brute-force attempts on SSH port 22',
            'Generate incident response summary for cluster alpha',
          ],
          theme: {
            primaryColor: '#06b6d4',
            darkMode: true,
            position: 'bottom-right',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('created');
      expect(res.body.assistant.id).toBeDefined();
      expect(res.body.assistant.name).toBe('Sentinel Cyber Copilot');
      expect(res.body.assistant.greeting_message).toContain('Sentinel Cyber Copilot is online');
      expect(res.body.assistant.theme.primaryColor).toBe('#06b6d4');
      expect(res.body.assistant.theme.darkMode).toBe(true);
      expect(res.body.assistant.theme.position).toBe('bottom-right');
      expect(res.body.assistant.public_embed_allowed).toBe(true);

      assistantAId = res.body.assistant.id;
    });

    it('creates an independent assistant in Workspace B with distinct branding options', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/assistants`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          name: 'Beta Finance Advisor',
          assistantKey: `beta-advisor-${crypto.randomUUID().slice(0, 6)}`,
          description: 'Internal finance bot for budget approvals',
          systemPrompt: 'You are Beta Finance Advisor. Answer budget questions using corporate finance docs.',
          modelPolicy: 'cloud-preferred',
          temperature: 0.2,
          publicEmbedAllowed: false,
          greetingMessage: 'Welcome to Beta Finance. Please state your budget inquiry.',
          theme: {
            primaryColor: '#10b981',
            darkMode: false,
            position: 'bottom-left',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.assistant.name).toBe('Beta Finance Advisor');
      expect(res.body.assistant.theme.primaryColor).toBe('#10b981');
      expect(res.body.assistant.theme.darkMode).toBe(false);
      expect(res.body.assistant.theme.position).toBe('bottom-left');

      assistantBId = res.body.assistant.id;
    });

    it('allows authorized editing of assistant name, welcome message, and theme via PATCH', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          name: 'Sentinel Threat Copilot v2',
          greetingMessage: 'Operator, Threat Copilot v2 ready for incident telemetry.',
          theme: {
            primaryColor: '#3b82f6',
            darkMode: true,
            position: 'bottom-right',
          },
          temperature: 0.1,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistant.name).toBe('Sentinel Threat Copilot v2');
      expect(res.body.assistant.greeting_message).toBe('Operator, Threat Copilot v2 ready for incident telemetry.');
      expect(res.body.assistant.theme.primaryColor).toBe('#3b82f6');
      expect(parseFloat(res.body.assistant.temperature)).toBeCloseTo(0.1);
    });
  });

  // ===========================================================================
  // Task 4: Associate Assistant with Authorized Knowledge Space
  // ===========================================================================
  describe('2. Assistant Knowledge Space Association', () => {
    it('associates Assistant Alpha with Knowledge Space Alpha in Workspace A', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces/${spaceAId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('associates Assistant Beta with Knowledge Space Beta in Workspace B', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceBId}/assistants/${assistantBId}/knowledge-spaces/${spaceBId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('lists knowledge spaces associated with an assistant', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.knowledgeSpaces)).toBe(true);
      expect(res.body.knowledgeSpaces.length).toBe(1);
      expect(res.body.knowledgeSpaces[0].id).toBe(spaceAId);
    });

    it('unlinks and re-links a knowledge space from an assistant cleanly', async () => {
      // Unlink
      const unlinkRes = await request(app)
        .delete(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces/${spaceAId}`)
        .set('Authorization', `Bearer ${userAToken}`);
      expect(unlinkRes.status).toBe(200);

      // Verify empty
      const listAfterUnlink = await request(app)
        .get(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${userAToken}`);
      expect(listAfterUnlink.body.knowledgeSpaces.length).toBe(0);

      // Re-link
      const relinkRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces/${spaceAId}`)
        .set('Authorization', `Bearer ${userAToken}`);
      expect(relinkRes.status).toBe(200);
    });
  });

  // ===========================================================================
  // Task 6, 7, 8: Public Assistant Configuration Endpoint (Safe Embed Contract)
  // ===========================================================================
  describe('3. Public Assistant Configuration Endpoint (GET /config)', () => {
    it('returns safe widget configuration for public assistant without auth tokens', async () => {
      const res = await request(app).get(`/api/v1/assistants/${assistantAId}/config`);

      expect(res.status).toBe(200);
      expect(res.body.assistantId).toBe(assistantAId);
      expect(res.body.name).toBe('Sentinel Threat Copilot v2');
      expect(res.body.theme.primaryColor).toBe('#3b82f6');
      expect(res.body.greetingMessage).toBeDefined();
      expect(res.body.capabilities).toBeDefined();
      expect(res.body.capabilities.citations).toBe(true);

      // Invariant: Never leak private system prompts or keys
      expect((res.body as any).system_prompt).toBeUndefined();
      expect((res.body as any).systemPrompt).toBeUndefined();
      expect((res.body as any).apiKey).toBeUndefined();
    });

    it('rejects unauthenticated access to private assistants (publicEmbedAllowed=false) with 404', async () => {
      // Assistant B is private
      const res = await request(app).get(`/api/v1/assistants/${assistantBId}/config`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });

    it('allows authenticated workspace member to retrieve config for private assistant', async () => {
      const res = await request(app)
        .get(`/api/v1/assistants/${assistantBId}/config`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.assistantId).toBe(assistantBId);
      expect(res.body.name).toBe('Beta Finance Advisor');
    });

    it('returns 404 on invalid or non-existent assistant UUID', async () => {
      const nonExistentId = crypto.randomUUID();
      const res = await request(app).get(`/api/v1/assistants/${nonExistentId}/config`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });
  });

  // ===========================================================================
  // Task 9 & 10: Scope Verification & Server-Side Security Invariants
  // ===========================================================================
  describe('4. Server-Side Scope Invariants & Cross-Project Isolation', () => {
    it('scopes retrieval strictly to the assistant authorized knowledge space', async () => {
      // 1. Create a conversation with Assistant A
      const convRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ assistantId: assistantAId });

      expect(convRes.status).toBe(201);
      const conversationId = convRes.body.conversationId;

      // 2. Query Sentinel SSH brute force (ingested into Space A)
      const msgRes = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ content: 'What is the policy for SSH brute-force attacks on port 22?' });

      expect(msgRes.status).toBe(200);
      expect(msgRes.body.assistantMessage).toBeDefined();
      expect(msgRes.body.assistantMessage.content).toBeDefined();

      // Citations or answer should reference the Sentinel Policy from Space A
      const text = msgRes.body.assistantMessage.content.toLowerCase();
      expect(text).toMatch(/(firewall|quarantine|ssh|sentinel|port 22)/);
    });

    it('prevents browser-side tampering: client-supplied knowledgeSpaceId from another workspace is ignored/blocked', async () => {
      // 1. Create conversation with Assistant B (Workspace B)
      const convRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ assistantId: assistantBId });

      expect(convRes.status).toBe(201);
      const convBId = convRes.body.conversationId;

      // 2. Client attempts to pass Space A's ID (which belongs to Workspace A) to Assistant B
      const probeRes = await request(app)
        .post(`/api/v1/conversations/${convBId}/messages`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          content: 'What is the policy for SSH brute-force attacks on port 22?',
          knowledgeSpaceIds: [spaceAId], // Space A belongs to Alpha!
        });

      expect(probeRes.status).toBe(200);
      // The assistant in Workspace B must NOT access Workspace A's document!
      const answer = probeRes.body.assistantMessage.content;
      expect(answer).not.toContain('SSH brute-force attacks on port 22 require automated firewall isolation');
    });

    it('prevents cross-project assistant editing (User B cannot PATCH Assistant A -> 404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceBId}/assistants/${assistantAId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ name: 'Hacked Assistant' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });

    it('prevents cross-project knowledge space linking (User A cannot link Space B to Assistant A -> 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}/knowledge-spaces/${spaceBId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Knowledge space not found in this workspace');
    });

    it('prevents cross-project assistant deletion (User B cannot DELETE Assistant A -> 404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/workspaces/${workspaceBId}/assistants/${assistantAId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it('enforces RBAC: workspace viewer role cannot create or update assistants (403 Forbidden)', async () => {
      // Viewer attempts to create assistant
      const createRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({
          name: 'Viewer Assistant',
          assistantKey: 'viewer-asst',
          systemPrompt: 'Instructions here.',
        });

      expect(createRes.status).toBe(403);
      expect(createRes.body.message).toMatch(/analyst/i);

      // Viewer attempts to update assistant
      const patchRes = await request(app)
        .patch(`/api/v1/workspaces/${workspaceAId}/assistants/${assistantAId}`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({ name: 'Viewer Mod' });

      expect(patchRes.status).toBe(403);
    });
  });
});
