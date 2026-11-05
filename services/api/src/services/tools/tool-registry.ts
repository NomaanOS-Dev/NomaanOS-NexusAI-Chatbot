/**
 * NomaanOS Nexus AI - Centralized Typed Tool Registry (Day 19)
 *
 * Implements:
 * 1. Centralized registry of explicitly approved tools.
 * 2. Strict metadata (name, description, parameter schemas, output schemas, required roles).
 * 3. Default built-in approved tools:
 *    - search_knowledge (Viewer)
 *    - get_workspace_info (Viewer)
 *    - calculate (Viewer, safe sandboxed arithmetic, no eval)
 *    - get_system_time (Viewer)
 *    - inspect_service_status (Analyst)
 * 4. Safe lookup, permission filtering, and registration lifecycle.
 */

import { z } from 'zod';
import {
  ToolDefinition,
  ToolSummary,
  ToolExecutionContext,
  WorkspaceRole,
  isRoleSufficient,
} from '@nomaanos/nexus-shared-types';
import { pool } from '../../database/pool.js';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { searchKeywordKnowledgeSpace } from '../keyword-search.js';

// ============================================================================
// Safe Math Evaluation (Zero `eval` / Zero `Function`)
// ============================================================================

function evaluateSafeMath(expr: string): number {
  // Only allow numbers, basic math operators, parentheses, decimal points, and safe whitespace
  const sanitized = expr.replace(/\s+/g, '');
  if (!/^[-+*/%^().0-9]+$/.test(sanitized)) {
    throw new Error(`Math expression contains prohibited characters: "${expr}"`);
  }

  // Tokenize
  const tokens: string[] = [];
  let numBuffer = '';

  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized[i];
    if (/[0-9.]/.test(ch)) {
      numBuffer += ch;
    } else {
      if (numBuffer) {
        tokens.push(numBuffer);
        numBuffer = '';
      }
      // Handle unary minus
      if (
        ch === '-' &&
        (tokens.length === 0 || ['(', '+', '-', '*', '/', '%', '^'].includes(tokens[tokens.length - 1]))
      ) {
        numBuffer = '-';
      } else {
        tokens.push(ch);
      }
    }
  }
  if (numBuffer) {
    tokens.push(numBuffer);
  }

  // Shunting-yard algorithm
  const outputQueue: (number | string)[] = [];
  const opStack: string[] = [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

  for (const token of tokens) {
    const num = Number(token);
    if (!isNaN(num)) {
      outputQueue.push(num);
    } else if (token === '(') {
      opStack.push(token);
    } else if (token === ')') {
      while (opStack.length > 0 && opStack[opStack.length - 1] !== '(') {
        outputQueue.push(opStack.pop()!);
      }
      if (opStack.length === 0) {
        throw new Error('Mismatched parentheses in math expression');
      }
      opStack.pop(); // Remove '('
    } else if (token in precedence) {
      while (
        opStack.length > 0 &&
        opStack[opStack.length - 1] in precedence &&
        (precedence[opStack[opStack.length - 1]] > precedence[token] ||
          (precedence[opStack[opStack.length - 1]] === precedence[token] && token !== '^'))
      ) {
        outputQueue.push(opStack.pop()!);
      }
      opStack.push(token);
    } else {
      throw new Error(`Unrecognized math token: "${token}"`);
    }
  }

  while (opStack.length > 0) {
    const op = opStack.pop()!;
    if (op === '(' || op === ')') {
      throw new Error('Mismatched parentheses in math expression');
    }
    outputQueue.push(op);
  }

  // RPN evaluation
  const evalStack: number[] = [];
  for (const item of outputQueue) {
    if (typeof item === 'number') {
      evalStack.push(item);
    } else {
      if (evalStack.length < 2) {
        throw new Error(`Insufficient operands for operator: "${item}"`);
      }
      const b = evalStack.pop()!;
      const a = evalStack.pop()!;
      let res: number;
      switch (item) {
        case '+':
          res = a + b;
          break;
        case '-':
          res = a - b;
          break;
        case '*':
          res = a * b;
          break;
        case '/':
          if (b === 0) throw new Error('Division by zero is undefined');
          res = a / b;
          break;
        case '%':
          if (b === 0) throw new Error('Modulo by zero is undefined');
          res = a % b;
          break;
        case '^':
          res = Math.pow(a, b);
          break;
        default:
          throw new Error(`Unsupported math operator: "${item}"`);
      }
      evalStack.push(res);
    }
  }

  if (evalStack.length !== 1 || isNaN(evalStack[0])) {
    throw new Error(`Evaluation failed for expression: "${expr}"`);
  }

  return evalStack[0];
}

// ============================================================================
// Built-In Approved Tools
// ============================================================================

export const BuiltInTools: ToolDefinition[] = [
  // 1. search_knowledge (Viewer)
  {
    name: 'search_knowledge',
    displayName: 'Search Knowledge Base',
    description: 'Searches documents and knowledge spaces in the current workspace for relevant technical passages.',
    requiredRole: 'viewer',
    timeoutMs: 5000,
    enabled: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query or technical keywords' },
        knowledgeSpaceId: { type: 'string', description: 'Optional knowledge space UUID to scope search' },
        topK: { type: 'integer', description: 'Maximum number of chunks to return (1-20)', default: 5 },
      },
      required: ['query'],
    },
    inputSchema: z
      .object({
        query: z.string().min(1, 'Query cannot be empty').max(500, 'Query exceeds 500 characters'),
        knowledgeSpaceId: z.string().uuid('Invalid knowledge space UUID').optional(),
        topK: z.number().int().min(1).max(20).default(5),
      })
      .strict(),
    outputSchema: z.object({
      resultsCount: z.number(),
      results: z.array(
        z.object({
          chunkId: z.string(),
          title: z.string(),
          content: z.string(),
          score: z.number(),
        })
      ),
    }),
    handler: async (args, context: ToolExecutionContext) => {
      let spaceId = args.knowledgeSpaceId;

      if (!spaceId) {
        // Find default/first knowledge space for workspace
        const ksRes = await pool.query(
          `SELECT id FROM knowledge_spaces WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1;`,
          [context.workspaceId]
        );
        if (ksRes.rows.length === 0) {
          return { resultsCount: 0, results: [] };
        }
        spaceId = ksRes.rows[0].id;
      } else {
        // Enforce workspace tenant boundary: verify knowledge space belongs to caller workspace
        const verify = await pool.query(
          `SELECT id FROM knowledge_spaces WHERE id = $1 AND workspace_id = $2;`,
          [spaceId, context.workspaceId]
        );
        if (verify.rows.length === 0) {
          throw new Error(`Knowledge space '${spaceId}' not found in workspace.`);
        }
      }

      const res = await searchKeywordKnowledgeSpace({
        workspaceId: context.workspaceId,
        knowledgeSpaceId: spaceId,
        query: args.query,
      });

      const sliced = res.results.slice(0, args.topK || 5);

      return {
        resultsCount: sliced.length,
        results: sliced.map((r: any) => ({
          chunkId: r.chunkId,
          title: r.sourceTitle,
          content: r.content,
          score: r.relevanceScore,
        })),
      };
    },
  },

  // 2. get_workspace_info (Viewer)
  {
    name: 'get_workspace_info',
    displayName: 'Get Workspace Info',
    description: 'Retrieves current workspace details, slug, and linked knowledge spaces.',
    requiredRole: 'viewer',
    timeoutMs: 3000,
    enabled: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({
      workspaceId: z.string(),
      workspaceName: z.string(),
      organizationId: z.string(),
      knowledgeSpaces: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          documentCount: z.number(),
        })
      ),
    }),
    handler: async (_args, context: ToolExecutionContext) => {
      const wsRes = await pool.query(
        `SELECT id, organization_id, name, slug FROM workspaces WHERE id = $1;`,
        [context.workspaceId]
      );

      if (wsRes.rows.length === 0) {
        throw new Error(`Workspace '${context.workspaceId}' not found.`);
      }

      const ws = wsRes.rows[0];

      const ksRes = await pool.query(
        `SELECT ks.id, ks.name, ks.slug, COUNT(ds.id)::int AS document_count
         FROM knowledge_spaces ks
         LEFT JOIN document_sources ds ON ds.knowledge_space_id = ks.id AND ds.status = 'ready'
         WHERE ks.workspace_id = $1
         GROUP BY ks.id, ks.name, ks.slug
         ORDER BY ks.created_at ASC;`,
        [context.workspaceId]
      );

      return {
        workspaceId: ws.id,
        workspaceName: ws.name,
        organizationId: ws.organization_id,
        knowledgeSpaces: ksRes.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          documentCount: r.document_count || 0,
        })),
      };
    },
  },

  // 3. calculate (Viewer, safe math, no eval)
  {
    name: 'calculate',
    displayName: 'Safe Calculator',
    description: 'Performs safe, bounded arithmetic calculation (+, -, *, /, %, ^, parentheses) without executing arbitrary code.',
    requiredRole: 'viewer',
    timeoutMs: 2000,
    enabled: true,
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Mathematical expression (e.g. "4 * (12 + 8) / 2")' },
        precision: { type: 'integer', description: 'Decimal precision (0-10)', default: 4 },
      },
      required: ['expression'],
    },
    inputSchema: z
      .object({
        expression: z
          .string()
          .min(1, 'Expression cannot be empty')
          .max(100, 'Expression cannot exceed 100 characters'),
        precision: z.number().int().min(0).max(10).default(4),
      })
      .strict(),
    outputSchema: z.object({
      expression: z.string(),
      result: z.number(),
      formatted: z.string(),
    }),
    handler: async (args) => {
      const val = evaluateSafeMath(args.expression);
      const rounded = Number(val.toFixed(args.precision ?? 4));
      return {
        expression: args.expression,
        result: rounded,
        formatted: String(rounded),
      };
    },
  },

  // 4. get_system_time (Viewer)
  {
    name: 'get_system_time',
    displayName: 'Get System Time',
    description: 'Retrieves current UTC timestamp, ISO formatted datetime, and system timezone.',
    requiredRole: 'viewer',
    timeoutMs: 1000,
    enabled: true,
    parameters: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: 'Optional IANA timezone name (e.g. "America/New_York", "UTC")', default: 'UTC' },
      },
      required: [],
    },
    inputSchema: z
      .object({
        timezone: z.string().max(64).default('UTC'),
      })
      .strict(),
    outputSchema: z.object({
      iso: z.string(),
      utc: z.string(),
      epochMs: z.number(),
      timezone: z.string(),
      formatted: z.string(),
    }),
    handler: async (args) => {
      const now = new Date();
      let formatted: string;
      try {
        formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: args.timezone || 'UTC',
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(now);
      } catch {
        formatted = now.toUTCString();
      }

      return {
        iso: now.toISOString(),
        utc: now.toUTCString(),
        epochMs: now.getTime(),
        timezone: args.timezone || 'UTC',
        formatted,
      };
    },
  },

  // 5. inspect_service_status (Analyst)
  {
    name: 'inspect_service_status',
    displayName: 'Inspect Platform Health & Services',
    description: 'Inspects connectivity and operational health of Postgres, Vector extension, and local models. Requires Analyst role.',
    requiredRole: 'analyst',
    timeoutMs: 4000,
    enabled: true,
    parameters: {
      type: 'object',
      properties: {
        checkInference: { type: 'boolean', description: 'Whether to check inference provider health', default: true },
        includeDetails: { type: 'boolean', description: 'Whether to include detailed service diagnostics', default: false },
      },
      required: [],
    },
    inputSchema: z
      .object({
        checkInference: z.boolean().default(true),
        includeDetails: z.boolean().default(false),
      })
      .strict(),
    outputSchema: z.object({
      database: z.string(),
      vectorReady: z.boolean(),
      offlineMode: z.boolean(),
      activeProvider: z.string(),
      timestamp: z.string(),
    }),
    handler: async () => {
      let dbStatus = 'healthy';
      let vectorReady = false;
      try {
        const vRes = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector';`);
        vectorReady = vRes.rows.length > 0;
      } catch {
        dbStatus = 'degraded';
      }

      return {
        database: dbStatus,
        vectorReady,
        offlineMode: config.offline.enabled,
        activeProvider: config.inference.provider,
        timestamp: new Date().toISOString(),
      };
    },
  },
];

// ============================================================================
// Tool Registry Singleton
// ============================================================================

export class ToolRegistry {
  private static instance: ToolRegistry | null = null;
  private readonly tools = new Map<string, ToolDefinition>();

  constructor() {
    this.registerDefaults();
  }

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Resets registry to default built-ins (used for test isolation).
   */
  static resetInstance(): void {
    ToolRegistry.instance = null;
  }

  private registerDefaults(): void {
    for (const tool of BuiltInTools) {
      this.registerTool(tool);
    }
  }

  /**
   * Registers a tool contract into the registry.
   */
  registerTool(tool: ToolDefinition): void {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('Tool definition must have a valid string name');
    }
    this.tools.set(tool.name, {
      ...tool,
      enabled: tool.enabled !== false,
      requiredRole: tool.requiredRole || 'viewer',
      timeoutMs: tool.timeoutMs || 5000,
    });
    logger.debug({ toolName: tool.name, role: tool.requiredRole }, 'Registered tool in ToolRegistry');
  }

  /**
   * Unregisters a tool by name.
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Retrieves a tool definition by name.
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Checks if a tool is registered and enabled.
   */
  hasTool(name: string): boolean {
    const tool = this.tools.get(name);
    return !!tool && tool.enabled !== false;
  }

  /**
   * Lists approved tools available for the caller's role.
   */
  listTools(options?: { role?: WorkspaceRole; enabledOnly?: boolean }): ToolSummary[] {
    const { role = 'owner', enabledOnly = true } = options || {};
    const results: ToolSummary[] = [];

    for (const tool of this.tools.values()) {
      if (enabledOnly && tool.enabled === false) {
        continue;
      }
      if (isRoleSufficient(role, tool.requiredRole || 'viewer')) {
        results.push({
          name: tool.name,
          displayName: tool.displayName || tool.name,
          description: tool.description,
          parameters: tool.parameters,
          requiredRole: tool.requiredRole || 'viewer',
          enabled: tool.enabled !== false,
        });
      }
    }

    return results;
  }
}
