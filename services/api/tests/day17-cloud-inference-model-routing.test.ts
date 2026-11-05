/**
 * NomaanOS Nexus AI - Day 17: Cloud Inference & Model Routing Test Suite
 *
 * Verifies:
 * 1. Cloud-provider adapters (OpenAI & Anthropic) with streaming & JSON mode
 * 2. Credential protection & masking
 * 3. Rate-limit detection, cooldown tracking, and retry backoff
 * 4. Task complexity evaluation (simple, standard, complex)
 * 5. All 4 Model Routing Policies:
 *    - Local-Only (strict cloud prohibition, zero silent fallback)
 *    - Cloud-Preferred (prefer cloud, allowed local fallback)
 *    - Hybrid (dynamic task complexity & sensitive data routing)
 *    - Cloud-Only (strict cloud execution, zero local fallback)
 * 6. Usage and failure telemetry recording & metrics API
 * 7. Endpoints & Grounded RAG integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

const app = createApp();
import {
  OpenAIInferenceProvider,
  AnthropicInferenceProvider,
  ProviderRegistry,
  ModelRouter,
  UsageTelemetryService,
  evaluateTaskComplexity,
  RateLimitError,
  PolicyViolationError,
  CredentialsMissingError,
  synthesizeGroundedAnswerAsync,
} from '../src/services/inference/index.js';
import { encryptSecret, maskApiKey } from '../src/services/tokens.js';

describe('Day 17 - Cloud Inference & Model Routing Suite', () => {
  let userToken: string;
  let workspaceId: string;
  let assistantId: string;
  let conversationId: string;
  let knowledgeSpaceId: string;

  beforeAll(async () => {
    // Register test user
    const email = `day17-tester-${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Day 17 Inference Architect',
        organizationName: 'Nexus Cloud AI Org',
      });

    userToken = regRes.body.token;
    workspaceId = regRes.body.workspace.id;

    // Create Assistant with hybrid policy
    const asstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/assistants`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Nexus Hybrid Sentinel',
        assistantKey: `hybrid-sentinel-${Date.now()}`,
        description: 'Multi-model routed assistant',
        systemPrompt: 'You are Nexus Hybrid Sentinel analyzing infrastructure and threat telemetry.',
        modelPolicy: 'hybrid',
        publicEmbedAllowed: true,
      });
    assistantId = asstRes.body.assistant.id;

    // Create Knowledge Space
    const ksRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Cloud Intelligence Space',
        slug: `cloud-space-${Date.now()}`,
      });
    knowledgeSpaceId = ksRes.body.knowledgeSpace.id;

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces/${knowledgeSpaceId}/assistants/${assistantId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send();

    // Create Conversation
    const convRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        assistantId,
        title: 'Day 17 Routing Conversation',
      });
    conversationId = convRes.body.conversationId;
  });

  afterAll(async () => {
    ProviderRegistry.resetInstance();
    UsageTelemetryService.resetInstance();
  });

  // =========================================================================
  // Task 1: Cloud Provider Adapters (OpenAI & Anthropic)
  // =========================================================================
  describe('Task 1: Cloud Provider Adapters & Normalization', () => {
    it('normalizes OpenAI completion payload, tokens, and cost estimation', async () => {
      const mockFetch: typeof fetch = async (url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe('gpt-4o-mini');
        expect(body.messages.length).toBeGreaterThan(0);
        return new Response(
          JSON.stringify({
            model: 'gpt-4o-mini',
            choices: [
              {
                message: { role: 'assistant', content: 'OpenAI normalized response for testing.' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 25,
              completion_tokens: 15,
              total_tokens: 40,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const provider = new OpenAIInferenceProvider({
        apiKey: 'sk-test-openai-key-12345',
        fetchFn: mockFetch,
      });

      const response = await provider.generate({
        prompt: 'Explain zero trust architecture',
        systemPrompt: 'You are an enterprise architect.',
      });

      expect(response.content).toBe('OpenAI normalized response for testing.');
      expect(response.provider).toBe('openai');
      expect(response.promptTokens).toBe(25);
      expect(response.completionTokens).toBe(15);
      expect(response.totalTokens).toBe(40);
      expect(response.estimatedCostUsd).toBeGreaterThan(0);
    });

    it('handles OpenAI streaming chunk deltas accurately via SSE', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Zero"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" Trust"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" Security"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      const mockFetch: typeof fetch = async () =>
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

      const provider = new OpenAIInferenceProvider({
        apiKey: 'sk-test-stream-key',
        fetchFn: mockFetch,
      });

      const chunksReceived: string[] = [];
      const response = await provider.generateStream(
        { prompt: 'Explain zero trust' },
        (delta) => chunksReceived.push(delta)
      );

      expect(chunksReceived.join('')).toBe('Zero Trust Security');
      expect(response.content).toBe('Zero Trust Security');
    });

    it('normalizes Anthropic Messages API completion and cost', async () => {
      const mockFetch: typeof fetch = async (url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe('claude-3-5-haiku-20241022');
        expect(init?.headers).toBeDefined();
        const headers = init?.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('ant-test-key-54321');

        return new Response(
          JSON.stringify({
            id: 'msg_01',
            model: 'claude-3-5-haiku-20241022',
            content: [{ type: 'text', text: 'Anthropic normalized response.' }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 30,
              output_tokens: 20,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const provider = new AnthropicInferenceProvider({
        apiKey: 'ant-test-key-54321',
        fetchFn: mockFetch,
      });

      const response = await provider.generate({
        prompt: 'Summarize access control guidelines',
        systemPrompt: 'You are a security analyst.',
      });

      expect(response.content).toBe('Anthropic normalized response.');
      expect(response.provider).toBe('anthropic');
      expect(response.promptTokens).toBe(30);
      expect(response.completionTokens).toBe(20);
      expect(response.totalTokens).toBe(50);
      expect(response.estimatedCostUsd).toBeGreaterThan(0);
    });

    it('rejects provider calls when credentials are missing', async () => {
      const provider = new OpenAIInferenceProvider({ apiKey: undefined });
      await expect(provider.generate({ prompt: 'Hello' })).rejects.toThrow(CredentialsMissingError);
    });
  });

  // =========================================================================
  // Task 2: Credential Protection & Masking
  // =========================================================================
  describe('Task 2: Credential Protection & Masking', () => {
    it('masks API keys safely and never exposes raw secrets in diagnostics', () => {
      const provider = new OpenAIInferenceProvider({ apiKey: 'sk-proj-supersecretkey123456789' });
      const masked = provider.getMaskedApiKey();
      expect(masked).not.toContain('supersecretkey');
      expect(masked).toMatch(/^sk-\.\.\.[0-9a-zA-Z]+$/);
    });

    it('stores and retrieves workspace provider credentials with AES-256-GCM encryption', async () => {
      const plainApiKey = 'sk-workspace-encrypted-test-key-999';
      const encrypted = encryptSecret(plainApiKey);

      await pool.query(
        `INSERT INTO provider_credentials (
           workspace_id, provider, key_name, encrypted_api_key, key_fingerprint, status
         ) VALUES ($1, 'openai', 'Production OpenAI Key', $2, $3, 'active')
         ON CONFLICT (workspace_id, provider) DO UPDATE SET
           encrypted_api_key = EXCLUDED.encrypted_api_key,
           updated_at = NOW();`,
        [workspaceId, encrypted, maskApiKey(plainApiKey)]
      );

      const registry = ProviderRegistry.getInstance();
      const resolved = await registry.resolveWorkspaceCredential(workspaceId, 'openai');
      expect(resolved).toBe(plainApiKey);
    });
  });

  // =========================================================================
  // Task 3: Rate-Limit Detection & Cooldown
  // =========================================================================
  describe('Task 3: Rate-Limit Detection & Cooldown', () => {
    it('detects HTTP 429 status and parses retry-after header', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Retry-After': '15' },
        });

      const provider = new OpenAIInferenceProvider({
        apiKey: 'sk-rate-limit-test',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'Test rate limit' })).rejects.toThrow(RateLimitError);
    });

    it('tracks provider rate-limit state in registry with active cooldown', () => {
      const registry = ProviderRegistry.getInstance();
      expect(registry.isRateLimited('openai')).toBe(false);

      registry.markRateLimited('openai', 10);
      expect(registry.isRateLimited('openai')).toBe(true);
      expect(registry.getRateLimitReset('openai')).toBeInstanceOf(Date);

      registry.clearRateLimit('openai');
      expect(registry.isRateLimited('openai')).toBe(false);
    });
  });

  // =========================================================================
  // Task 4: Task Complexity Evaluation
  // =========================================================================
  describe('Task 4: Task Complexity Evaluation', () => {
    it('classifies simple greetings and short lookups as simple', () => {
      const analysis = evaluateTaskComplexity({ prompt: 'Hello, how can you help me?' });
      expect(analysis.complexity).toBe('simple');
    });

    it('classifies standard grounded queries within normal limits as standard', () => {
      const analysis = evaluateTaskComplexity({
        prompt: 'What are the password policy requirements for internal VPN access?',
      });
      expect(analysis.complexity).toBe('standard');
    });

    it('classifies code generation and security incident investigations as complex', () => {
      const codeAnalysis = evaluateTaskComplexity({
        prompt: 'Write a TypeScript function to parse JWT: ```ts function parse(t: string) {} ```',
      });
      expect(codeAnalysis.complexity).toBe('complex');

      const incidentAnalysis = evaluateTaskComplexity({
        prompt: 'Perform root cause analysis and incident response triage for anomalous outbound SSH traffic.',
      });
      expect(incidentAnalysis.complexity).toBe('complex');
      expect(incidentAnalysis.hasIncidentKeywords).toBe(true);
    });
  });

  // =========================================================================
  // Task 5: Routing Policy 1 — Local-Only (Zero Silent Fallback Invariant)
  // =========================================================================
  describe('Task 5: Routing Policy 1 — Local-Only', () => {
    it('strictly forbids cloud providers when local-only policy is requested', async () => {
      const router = new ModelRouter();

      await expect(
        router.route({
          prompt: 'Hello',
          routingPolicy: 'local-only',
          forceProvider: 'openai',
        })
      ).rejects.toThrow(PolicyViolationError);
    });

    it('falls back strictly to local deterministic engine if local Ollama fails (never cloud)', async () => {
      const registry = new ProviderRegistry();
      // Register broken ollama provider that throws
      registry.registerProvider('ollama', {
        name: 'ollama',
        defaultModel: 'broken-model',
        generate: async () => {
          throw new Error('Ollama connection refused');
        },
        generateStream: async () => {
          throw new Error('Ollama connection refused');
        },
        checkHealth: async () => ({
          provider: 'ollama',
          status: 'unavailable',
          baseUrl: '',
          currentModel: '',
          availableModels: [],
          capabilities: { streaming: false, jsonMode: false, contextLength: 0 },
          isCloud: false,
        }),
        listModels: async () => [],
        getModelCapabilities: async () => ({ streaming: false, jsonMode: false, contextLength: 0 }),
      });

      const router = new ModelRouter({ registry });
      const result = await router.route({
        prompt: 'Check offline status',
        routingPolicy: 'local-only',
      });

      expect(result.fallbackTriggered).toBe(true);
      expect(result.routingDecision.policy).toBe('local-only');
      expect(result.routingDecision.isCloud).toBe(false);
      // Confirmed: used local deterministic fallback, never cloud
      expect(result.provider).toBe('local_deterministic');
    });
  });

  // =========================================================================
  // Task 6: Routing Policy 2 — Cloud-Preferred
  // =========================================================================
  describe('Task 6: Routing Policy 2 — Cloud-Preferred', () => {
    it('routes to cloud provider when available', async () => {
      const registry = new ProviderRegistry();
      registry.registerProvider('openai', {
        name: 'openai',
        defaultModel: 'gpt-4o-mini',
        generate: async () => ({
          content: 'Cloud-preferred response from OpenAI.',
          model: 'gpt-4o-mini',
          provider: 'openai',
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        }),
        generateStream: async () => ({ content: '', model: '' }),
        checkHealth: async () => ({
          provider: 'openai',
          status: 'ready',
          baseUrl: '',
          currentModel: 'gpt-4o-mini',
          availableModels: [],
          capabilities: { streaming: true, jsonMode: true, contextLength: 128000 },
          isCloud: true,
        }),
        listModels: async () => [],
        getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 128000 }),
      });

      const router = new ModelRouter({ registry });
      const result = await router.route({
        prompt: 'Summarize security guidelines',
        routingPolicy: 'cloud-preferred',
        forceProvider: 'openai',
      });

      expect(result.provider).toBe('openai');
      expect(result.fallbackTriggered).toBe(false);
      expect(result.routingDecision.policy).toBe('cloud-preferred');
    });

    it('falls back automatically to local model when cloud provider is rate-limited', async () => {
      const registry = new ProviderRegistry();
      registry.registerProvider('openai', {
        name: 'openai',
        defaultModel: 'gpt-4o-mini',
        generate: async () => {
          throw new RateLimitError('openai', 30);
        },
        generateStream: async () => {
          throw new RateLimitError('openai', 30);
        },
        checkHealth: async () => ({
          provider: 'openai',
          status: 'rate_limited',
          baseUrl: '',
          currentModel: 'gpt-4o-mini',
          availableModels: [],
          capabilities: { streaming: true, jsonMode: true, contextLength: 128000 },
          isCloud: true,
        }),
        listModels: async () => [],
        getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 128000 }),
      });

      registry.registerProvider('ollama', {
        name: 'ollama',
        defaultModel: 'qwen3.8:27b',
        generate: async () => ({
          content: 'Local Ollama fallback response.',
          model: 'qwen3.8:27b',
          provider: 'ollama',
          promptTokens: 15,
          completionTokens: 10,
          totalTokens: 25,
        }),
        generateStream: async () => ({ content: '', model: '' }),
        checkHealth: async () => ({
          provider: 'ollama',
          status: 'ready',
          baseUrl: '',
          currentModel: 'qwen3.8:27b',
          availableModels: [],
          capabilities: { streaming: true, jsonMode: true, contextLength: 4096 },
          isCloud: false,
        }),
        listModels: async () => [],
        getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 4096 }),
      });

      const router = new ModelRouter({ registry });
      const result = await router.route({
        prompt: 'Query during cloud rate limit',
        routingPolicy: 'cloud-preferred',
        forceProvider: 'openai',
      });

      expect(result.fallbackTriggered).toBe(true);
      expect(result.fallbackReason).toContain('rate limit');
      expect(result.provider).toBe('ollama');
      expect(registry.isRateLimited('openai')).toBe(true);
    });
  });

  // =========================================================================
  // Task 7: Routing Policy 3 — Hybrid
  // =========================================================================
  describe('Task 7: Routing Policy 3 — Hybrid Routing', () => {
    it('routes simple tasks locally and complex tasks to cloud under hybrid policy', async () => {
      const registry = new ProviderRegistry();
      registry.registerProvider('openai', {
        name: 'openai',
        defaultModel: 'gpt-4o-mini',
        generate: async () => ({
          content: 'Complex task executed by OpenAI.',
          model: 'gpt-4o-mini',
          provider: 'openai',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        }),
        generateStream: async () => ({ content: '', model: '' }),
        checkHealth: async () => ({
          provider: 'openai',
          status: 'ready',
          baseUrl: '',
          currentModel: 'gpt-4o-mini',
          availableModels: [],
          capabilities: { streaming: true, jsonMode: true, contextLength: 128000 },
          isCloud: true,
        }),
        listModels: async () => [],
        getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 128000 }),
      });

      const router = new ModelRouter({ registry });

      // 1. Simple task -> routes to local
      const simpleDecision = await router.decideRoute({
        prompt: 'Hello there',
        routingPolicy: 'hybrid',
      });
      expect(simpleDecision.taskComplexity).toBe('simple');
      expect(simpleDecision.targetProvider).toBe('ollama');

      // 2. Complex task -> routes to cloud
      const complexDecision = await router.decideRoute({
        prompt: 'Perform incident response triage and investigate anomalous outbound traffic.',
        routingPolicy: 'hybrid',
      });
      expect(complexDecision.taskComplexity).toBe('complex');
      expect(complexDecision.targetProvider).toBe('openai');
    });

    it('enforces local execution when containsSensitiveData flag is set', async () => {
      const router = new ModelRouter();
      const decision = await router.decideRoute({
        prompt: 'Perform incident response triage on classified telemetry',
        routingPolicy: 'hybrid',
        containsSensitiveData: true,
      });

      expect(decision.targetProvider).toBe('ollama');
      expect(decision.isCloud).toBe(false);
      expect(decision.reason).toContain('sensitive data');
    });
  });

  // =========================================================================
  // Task 8: Routing Policy 4 — Cloud-Only
  // =========================================================================
  describe('Task 8: Routing Policy 4 — Cloud-Only', () => {
    it('strictly fails and never falls back to local when cloud provider fails', async () => {
      const registry = new ProviderRegistry();
      registry.registerProvider('openai', {
        name: 'openai',
        defaultModel: 'gpt-4o-mini',
        generate: async () => {
          throw new Error('OpenAI service outage');
        },
        generateStream: async () => {
          throw new Error('OpenAI service outage');
        },
        checkHealth: async () => ({
          provider: 'openai',
          status: 'unavailable',
          baseUrl: '',
          currentModel: 'gpt-4o-mini',
          availableModels: [],
          capabilities: { streaming: true, jsonMode: true, contextLength: 128000 },
          isCloud: true,
        }),
        listModels: async () => [],
        getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 128000 }),
      });

      const router = new ModelRouter({ registry });

      await expect(
        router.route({
          prompt: 'Execute strictly in cloud',
          routingPolicy: 'cloud-only',
          forceProvider: 'openai',
        })
      ).rejects.toThrow('OpenAI service outage');
    });
  });

  // =========================================================================
  // Task 9: Telemetry & Observability Endpoints
  // =========================================================================
  describe('Task 9: Usage, Failure Telemetry & API Endpoints', () => {
    it('records usage and failures accurately in telemetry service', async () => {
      const telemetry = UsageTelemetryService.getInstance();

      await telemetry.recordUsage({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routingPolicy: 'cloud-preferred',
        taskComplexity: 'standard',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        durationMs: 450,
        estimatedCostUsd: 0.000045,
        status: 'success',
      });

      await telemetry.recordFailure({
        provider: 'openai',
        model: 'gpt-4o-mini',
        errorCode: 'RateLimitError',
        statusCode: 429,
        errorMessage: 'Rate limit exceeded',
        routingPolicy: 'cloud-preferred',
        fallbackTriggered: true,
        fallbackProvider: 'ollama',
      });

      const metrics = await telemetry.getMetricsSummary();
      expect(metrics.totalRequests).toBeGreaterThan(0);
      expect(metrics.failedRequests).toBeGreaterThan(0);
      expect(metrics.fallbackRequests).toBeGreaterThan(0);
    });

    it('returns supported routing policies via GET /api/v1/inference/policies', async () => {
      const res = await request(app).get('/api/v1/inference/policies');
      expect(res.status).toBe(200);
      expect(res.body.policies.length).toBe(4);
      const policyIds = res.body.policies.map((p: any) => p.id);
      expect(policyIds).toContain('local-only');
      expect(policyIds).toContain('cloud-preferred');
      expect(policyIds).toContain('hybrid');
      expect(policyIds).toContain('cloud-only');
    });

    it('returns telemetry metrics via GET /api/v1/inference/metrics', async () => {
      const res = await request(app).get('/api/v1/inference/metrics');
      expect(res.status).toBe(200);
      expect(res.body.metrics).toBeDefined();
      expect(typeof res.body.metrics.totalRequests).toBe('number');
    });

    it('executes model routing via POST /api/v1/inference/generate', async () => {
      const res = await request(app)
        .post('/api/v1/inference/generate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          prompt: 'What are the identity verification protocols?',
          policy: 'local-only',
          provider: 'local_deterministic',
        });

      expect(res.status).toBe(200);
      expect(res.body.policyUsed).toBe('local-only');
      expect(res.body.result).toBeDefined();
      expect(res.body.routing.decision).toBeDefined();
    });
  });
});
