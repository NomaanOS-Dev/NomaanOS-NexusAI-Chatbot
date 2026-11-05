/**
 * Day 19 Test Suite: Typed Tool Registry, Argument Validation & Controlled Agent Loop
 *
 * Verifies:
 * 1. Typed Tool Registry (metadata, parameter contracts, schemas, lifecycle).
 * 2. Strict Input & Output Argument Validation (Zod schemas, extra fields rejection, bounds).
 * 3. Permission-Aware Execution & Cross-Tenant Security (RBAC revalidation, server-side context).
 * 4. Bounded Agent Loop (iterations, tool budgets, observational turns, safe completion).
 * 5. Timeouts & Cancellation (per-tool timeouts, parent AbortSignal propagation).
 * 6. Audit Logging & Credential Sanitization (DB persistence, secret masking).
 * 7. Separation of Untrusted Proposals from Authorized Handlers.
 * 8. End-to-End REST API Endpoints (/api/v1/tools, /api/v1/tools/execute, /api/v1/tools/executions, /api/v1/agent/run).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { ToolRegistry } from '../src/services/tools/tool-registry.js';
import { executeTool } from '../src/services/tools/tool-executor.js';
import { runControlledAgentLoop, extractToolProposals } from '../src/services/tools/agent-loop.js';
import { sanitizeToolArguments, validateToolProposal } from '../src/services/tools/tool-validator.js';
import { ProviderRegistry } from '../src/services/inference/provider-registry.js';
import { ToolDefinition, ToolExecutionContext } from '@nomaanos/nexus-shared-types';

const app = createApp();

describe('Day 19 - Tool Registry & Controlled Agent Loop Suite', () => {
  let adminToken: string;
  let adminUserId: string;
  let workspaceId: string;
  let viewerToken: string;
  let viewerUserId: string;
  let otherWorkspaceId: string;
  let knowledgeSpaceId: string;

  const registerStandardMock = () => {
    const providerRegistry = ProviderRegistry.getInstance();
    providerRegistry.registerProvider('ollama', {
      name: 'ollama',
      defaultModel: 'agent-mock-v1',
      generate: async (opts: any) => {
        // If prompt indicates previous calculation result, return final answer
        if (opts.prompt.includes('42') || opts.prompt.includes('[Tool Result')) {
          return {
            content: 'The computed mathematical result is 42. No further tools needed.',
            model: 'agent-mock-v1',
            provider: 'ollama',
            tokensPrompt: 50,
            tokensCompletion: 20,
            totalTokens: 70,
            finishReason: 'stop',
          };
        }

        // Propose calculate tool call
        return {
          content: '```json\n{\n  "thought": "Evaluate the arithmetic formula",\n  "tool_calls": [\n    {\n      "name": "calculate",\n      "arguments": { "expression": "6 * 7" }\n    }\n  ]\n}\n```',
          model: 'agent-mock-v1',
          provider: 'ollama',
          tokensPrompt: 40,
          tokensCompletion: 30,
          totalTokens: 70,
          finishReason: 'stop',
        };
      },
      generateStream: async function* () {
        yield { chunk: 'The computed mathematical result is 42.', isFinal: true };
      },
      checkHealth: async () => ({
        provider: 'ollama',
        status: 'healthy',
        baseUrl: 'http://localhost:11434',
        currentModel: 'agent-mock-v1',
        availableModels: ['agent-mock-v1'],
        capabilities: { streaming: true, jsonMode: true, contextLength: 8192 },
        isCloud: false,
      }),
      listModels: async () => ['agent-mock-v1'],
      getModelCapabilities: async () => ({ streaming: true, jsonMode: true, contextLength: 8192 }),
    });
  };

  beforeAll(async () => {
    // 1. Register Admin User
    const adminEmail = `day19-admin-${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: adminEmail,
        password: 'Password123!',
        fullName: 'Lead Operations Engineer',
        organizationName: 'Day19 SecOps Org',
      });

    adminToken = regRes.body.token;
    adminUserId = regRes.body.user.id;
    workspaceId = regRes.body.workspace.id;

    // 2. Create Knowledge Space
    const ksRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Infrastructure Knowledge',
        slug: `infra-knowledge-${Date.now()}`,
      });
    knowledgeSpaceId = ksRes.body.knowledgeSpace.id;

    // 3. Register Second User with Viewer role in the workspace
    const viewerEmail = `day19-viewer-${Date.now()}@example.com`;
    const viewerReg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: viewerEmail,
        password: 'Password123!',
        fullName: 'Junior Security Observer',
        organizationName: 'Viewer Secondary Org',
      });
    viewerToken = viewerReg.body.token;
    viewerUserId = viewerReg.body.user.id;

    // Add viewer to primary workspace with 'viewer' role
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'viewer')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'viewer';`,
      [workspaceId, viewerUserId]
    );

    // 4. Create an isolated other workspace (for cross-tenant attack verification)
    const otherWsRes = await pool.query(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ((SELECT organization_id FROM workspaces WHERE id = $1), 'Foreign Enclave', 'foreign-enclave-${Date.now()}')
       RETURNING id;`,
      [workspaceId]
    );
    otherWorkspaceId = otherWsRes.rows[0].id;

    // 5. Register Mock Inference Provider for deterministic agent loop testing
    registerStandardMock();
  });

  afterAll(async () => {
    ProviderRegistry.resetInstance();
    ToolRegistry.resetInstance();
  });

  // =========================================================================
  // Task 1: Typed Tool Registry
  // =========================================================================
  describe('Task 1: Typed Tool Registry', () => {
    it('initializes registry with approved built-in tools', () => {
      const registry = ToolRegistry.getInstance();
      expect(registry.hasTool('calculate')).toBe(true);
      expect(registry.hasTool('get_system_time')).toBe(true);
      expect(registry.hasTool('get_workspace_info')).toBe(true);
      expect(registry.hasTool('search_knowledge')).toBe(true);
      expect(registry.hasTool('inspect_service_status')).toBe(true);
    });

    it('rejects unknown and unregistered tool lookups', () => {
      const registry = ToolRegistry.getInstance();
      expect(registry.hasTool('unregistered_arbitrary_shell')).toBe(false);
      expect(registry.getTool('drop_database_tables')).toBeUndefined();
    });

    it('allows dynamic registration and unregistration of custom approved tools', () => {
      const registry = ToolRegistry.getInstance();
      const customTool: ToolDefinition = {
        name: 'custom_unit_converter',
        displayName: 'Custom Unit Converter',
        description: 'Converts MB to GB',
        requiredRole: 'viewer',
        timeoutMs: 1000,
        enabled: true,
        parameters: { type: 'object', properties: { mb: { type: 'number' } }, required: ['mb'] },
        inputSchema: z.object({ mb: z.number().min(0) }).strict(),
        outputSchema: z.object({ gb: z.number() }),
        handler: async (args) => ({ gb: args.mb / 1024 }),
      };

      registry.registerTool(customTool);
      expect(registry.hasTool('custom_unit_converter')).toBe(true);

      const removed = registry.unregisterTool('custom_unit_converter');
      expect(removed).toBe(true);
      expect(registry.hasTool('custom_unit_converter')).toBe(false);
    });
  });

  // =========================================================================
  // Task 2: Tool Argument & Output Contract Validation
  // =========================================================================
  describe('Task 2: Tool Argument & Output Contract Validation', () => {
    it('validates correct arguments against schema', () => {
      const registry = ToolRegistry.getInstance();
      const tool = registry.getTool('calculate')!;

      const outcome = validateToolProposal(
        {
          callId: 'call-1',
          toolName: 'calculate',
          arguments: { expression: '15 + 25', precision: 2 },
        },
        tool
      );

      expect(outcome.isValid).toBe(true);
      expect(outcome.data).toEqual({ expression: '15 + 25', precision: 2 });
    });

    it('rejects missing required arguments', () => {
      const registry = ToolRegistry.getInstance();
      const tool = registry.getTool('calculate')!;

      const outcome = validateToolProposal(
        {
          callId: 'call-2',
          toolName: 'calculate',
          arguments: { precision: 2 }, // Missing required 'expression'
        },
        tool
      );

      expect(outcome.isValid).toBe(false);
      expect(outcome.error).toContain('expression');
    });

    it('rejects unexpected and malformed arguments (strict mode)', () => {
      const registry = ToolRegistry.getInstance();
      const tool = registry.getTool('calculate')!;

      const outcome = validateToolProposal(
        {
          callId: 'call-3',
          toolName: 'calculate',
          arguments: {
            expression: '10 * 10',
            injectedExtraPayload: 'DROP TABLE users;', // Extra field prohibited
          },
        },
        tool
      );

      expect(outcome.isValid).toBe(false);
      expect(outcome.error).toContain('injectedExtraPayload');
    });

    it('rejects out-of-range numeric arguments', () => {
      const registry = ToolRegistry.getInstance();
      const tool = registry.getTool('calculate')!;

      const outcome = validateToolProposal(
        {
          callId: 'call-4',
          toolName: 'calculate',
          arguments: {
            expression: '10 * 10',
            precision: 99, // Max is 10
          },
        },
        tool
      );

      expect(outcome.isValid).toBe(false);
      expect(outcome.error).toContain('precision');
    });

    it('safely evaluates arithmetic expressions without arbitrary code execution', async () => {
      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
      };

      const result = await executeTool({
        proposal: {
          callId: 'calc-1',
          toolName: 'calculate',
          arguments: { expression: '((10 + 20) * 3) / 2' }, // 90 / 2 = 45
        },
        context,
      });

      expect(result.status).toBe('success');
      expect((result.output as any).result).toBe(45);
    });

    it('rejects code injection attempts in calculator math expressions', async () => {
      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
      };

      const result = await executeTool({
        proposal: {
          callId: 'exploit-1',
          toolName: 'calculate',
          arguments: { expression: 'process.exit(1)' },
        },
        context,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('prohibited characters');
    });
  });

  // =========================================================================
  // Task 3: Permission-Aware Execution & Cross-Tenant Boundary
  // =========================================================================
  describe('Task 3: Permission-Aware Execution & Cross-Tenant Boundary', () => {
    it('allows viewer to execute viewer-authorized tools', async () => {
      const context: ToolExecutionContext = {
        userId: viewerUserId,
        workspaceId,
        role: 'viewer',
      };

      const result = await executeTool({
        proposal: {
          callId: 'time-1',
          toolName: 'get_system_time',
          arguments: { timezone: 'UTC' },
        },
        context,
      });

      expect(result.status).toBe('success');
      expect((result.output as any).iso).toBeDefined();
    });

    it('strictly forbids viewer from executing analyst-only tools', async () => {
      const context: ToolExecutionContext = {
        userId: viewerUserId,
        workspaceId,
        role: 'viewer', // Viewer role is insufficient for Analyst tool
      };

      const result = await executeTool({
        proposal: {
          callId: 'status-1',
          toolName: 'inspect_service_status',
          arguments: { includeDetails: true },
        },
        context,
      });

      expect(result.status).toBe('rejected_unauthorized');
      expect(result.errorCode).toBe('INSUFFICIENT_ROLE');
      expect(result.error).toContain("requires role 'analyst'");
    });

    it('permits analyst or owner to execute analyst-only tool', async () => {
      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
      };

      const result = await executeTool({
        proposal: {
          callId: 'status-2',
          toolName: 'inspect_service_status',
          arguments: { includeDetails: true },
        },
        context,
      });

      expect(result.status).toBe('success');
      expect((result.output as any).database).toBe('healthy');
    });

    it('rejects cross-tenant access attempts', async () => {
      // Viewer belongs to workspaceId, but passes otherWorkspaceId in context
      const context: ToolExecutionContext = {
        userId: viewerUserId,
        workspaceId: otherWorkspaceId, // User is NOT a member of otherWorkspaceId
        role: 'viewer',
      };

      // Search knowledge space belonging to primary workspace inside foreign workspace context
      const result = await executeTool({
        proposal: {
          callId: 'cross-tenant-1',
          toolName: 'search_knowledge',
          arguments: {
            query: 'confidential runbooks',
            knowledgeSpaceId, // Belongs to workspaceId, NOT otherWorkspaceId
          },
        },
        context,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not found in workspace');
    });
  });

  // =========================================================================
  // Task 4: Bounded Controlled Agent Loop
  // =========================================================================
  describe('Task 4: Bounded Controlled Agent Loop', () => {
    it('executes a controlled loop where model proposes tools and synthesizes final answer', async () => {
      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
        correlationId: `test-loop-${Date.now()}`,
      };

      const agentResult = await runControlledAgentLoop({
        query: 'What is 6 multiplied by 7?',
        context,
        config: {
          maxIterations: 3,
          maxToolCalls: 5,
        },
      });

      expect(agentResult.stopReason).toBe('completed');
      expect(agentResult.iterations.length).toBeGreaterThan(0);
      expect(agentResult.totalToolCalls).toBe(1);
      expect(agentResult.finalResponse).toContain('42');
    });

    it('stops safely when maxIterations is reached without finishing', async () => {
      // Temporarily register a provider that keeps proposing tools endlessly
      const providerRegistry = ProviderRegistry.getInstance();
      providerRegistry.registerProvider('ollama', {
        name: 'ollama',
        defaultModel: 'infinite-loop-mock',
        generate: async () => ({
          content: '```json\n{\n  "thought": "Keep computing endlessly",\n  "tool_calls": [{ "name": "calculate", "arguments": { "expression": "1 + 1" } }]\n}\n```',
          model: 'infinite-loop-mock',
          provider: 'ollama',
          tokensPrompt: 10,
          tokensCompletion: 10,
          totalTokens: 20,
          finishReason: 'stop',
        }),
        generateStream: async function* () {},
        checkHealth: async () => ({} as any),
        listModels: async () => [],
        getModelCapabilities: async () => ({} as any),
      });

      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
      };

      const result = await runControlledAgentLoop({
        query: 'Count to infinity',
        context,
        config: {
          maxIterations: 2, // Hard bounded at 2 iterations
          maxToolCalls: 10,
        },
      });

      expect(result.stopReason).toBe('max_iterations_reached');
      expect(result.iterations.length).toBe(2);
      expect(result.finalResponse).toContain('maximum permitted iterations');

      // Restore standard mock provider
      registerStandardMock();
    });

    it('enforces maxToolCalls budget and stops before executing excessive tools', async () => {
      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
      };

      const result = await runControlledAgentLoop({
        query: 'Compute something bounded',
        context,
        config: {
          maxIterations: 5,
          maxToolCalls: 1, // Only 1 tool call allowed total
        },
      });

      expect(result.totalToolCalls).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // Task 5: Timeouts & Cancellation
  // =========================================================================
  describe('Task 5: Timeouts & Cancellation', () => {
    it('times out long-running tool operations safely without hanging', async () => {
      const registry = ToolRegistry.getInstance();
      // Register hanging tool
      registry.registerTool({
        name: 'hanging_mock_tool',
        displayName: 'Hanging Mock Tool',
        description: 'Simulates an unresponsive external service',
        requiredRole: 'viewer',
        timeoutMs: 150, // 150ms timeout
        enabled: true,
        parameters: { type: 'object', properties: {} },
        inputSchema: z.object({}).strict(),
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return { done: true };
        },
      });

      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
      };

      const result = await executeTool({
        proposal: { callId: 'hang-1', toolName: 'hanging_mock_tool', arguments: {} },
        context,
        timeoutMs: 150,
      });

      expect(result.status).toBe('timed_out');
      expect(result.errorCode).toBe('TIMEOUT');
      expect(result.error).toContain('timed out');
    });

    it('cancels tool execution immediately when parent AbortSignal triggers', async () => {
      const controller = new AbortController();
      controller.abort(new Error('User cancelled the query'));

      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
        signal: controller.signal,
      };

      const result = await executeTool({
        proposal: { callId: 'cancel-1', toolName: 'calculate', arguments: { expression: '1 + 1' } },
        context,
      });

      expect(result.status).toBe('cancelled');
      expect(result.errorCode).toBe('REQUEST_CANCELLED');
    });
  });

  // =========================================================================
  // Task 6: Audit Logging & Credential Sanitization
  // =========================================================================
  describe('Task 6: Audit Logging & Credential Sanitization', () => {
    it('sanitizes passwords, secrets, api keys, and bearer tokens from arguments', () => {
      const dirtyArgs = {
        expression: '10 + 20',
        apiKey: 'sk-1234567890abcdef1234567890abcdef1234567890',
        password: 'SuperSecretPassword123!',
        authToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
        nested: {
          private_key: '-----BEGIN PRIVATE KEY-----',
          safeLabel: 'Production Cluster',
        },
      };

      const sanitized = sanitizeToolArguments(dirtyArgs);

      expect(sanitized.expression).toBe('10 + 20');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.authToken).toBe('[REDACTED]');
      expect((sanitized.nested as any).private_key).toBe('[REDACTED]');
      expect((sanitized.nested as any).safeLabel).toBe('Production Cluster');
    });

    it('persists tool execution records into PostgreSQL table', async () => {
      const correlationId = `audit-test-${Date.now()}`;
      const context: ToolExecutionContext = {
        userId: adminUserId,
        workspaceId,
        role: 'owner',
        correlationId,
      };

      await executeTool({
        proposal: {
          callId: 'audit-exec-1',
          toolName: 'calculate',
          arguments: { expression: '8 * 8' },
        },
        context,
      });

      // Verify row in database
      const dbRow = await pool.query(
        `SELECT tool_name, status, correlation_id, sanitized_arguments
         FROM tool_execution_records
         WHERE correlation_id = $1;`,
        [correlationId]
      );

      expect(dbRow.rows.length).toBe(1);
      expect(dbRow.rows[0].tool_name).toBe('calculate');
      expect(dbRow.rows[0].status).toBe('success');
      expect(dbRow.rows[0].sanitized_arguments).toEqual({ expression: '8 * 8' });
    });
  });

  // =========================================================================
  // Task 7 & 8: End-to-End REST API Verification
  // =========================================================================
  describe('Task 7 & 8: End-to-End REST API Verification', () => {
    it('GET /api/v1/tools lists tools available to the authenticated caller', async () => {
      const res = await request(app)
        .get('/api/v1/tools')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.tools)).toBe(true);
      expect(res.body.tools.some((t: any) => t.name === 'calculate')).toBe(true);
      expect(res.body.tools.some((t: any) => t.name === 'inspect_service_status')).toBe(true);
    });

    it('GET /api/v1/tools filters tools appropriately for viewer role', async () => {
      const res = await request(app)
        .get('/api/v1/tools')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('X-Workspace-Id', workspaceId);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('viewer');
      // Viewer can see calculate
      expect(res.body.tools.some((t: any) => t.name === 'calculate')).toBe(true);
      // Viewer cannot see inspect_service_status
      expect(res.body.tools.some((t: any) => t.name === 'inspect_service_status')).toBe(false);
    });

    it('POST /api/v1/tools/execute executes approved tools via API', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          toolName: 'calculate',
          arguments: { expression: '25 + 75' },
        });

      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('success');
      expect(res.body.result.output.result).toBe(100);
    });

    it('POST /api/v1/tools/execute returns 400 on malformed tool arguments', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          toolName: 'calculate',
          arguments: { invalidKey: 'not-an-expression' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('InvalidToolArguments');
    });

    it('POST /api/v1/tools/execute returns 403 on insufficient permissions', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({
          toolName: 'inspect_service_status',
          arguments: { includeDetails: true },
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UnauthorizedToolExecution');
    });

    it('GET /api/v1/tools/executions returns audit log records', async () => {
      const res = await request(app)
        .get('/api/v1/tools/executions')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.records)).toBe(true);
      expect(res.body.totalCount).toBeGreaterThan(0);
    });

    it('POST /api/v1/agent/run executes controlled agent loop via API', async () => {
      const res = await request(app)
        .post('/api/v1/agent/run')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          query: 'Calculate 6 times 7',
          config: {
            maxIterations: 3,
            maxToolCalls: 2,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.stopReason).toBe('completed');
      expect(res.body.result.totalToolCalls).toBeGreaterThanOrEqual(1);
    });
  });
});
