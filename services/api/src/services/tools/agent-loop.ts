/**
 * NomaanOS Nexus AI - Bounded Controlled Agent Loop (Day 19)
 *
 * Implements:
 * 1. Bounded orchestration loop allowing the model to propose registered tool calls.
 * 2. Strict limits: maxIterations, maxToolCalls, perToolTimeoutMs, overallTimeoutMs.
 * 3. Immediate safety stop when limits are exceeded, client disconnects, or cancellation fires.
 * 4. Separate proposal step: untrusted model output parsed -> validated -> executed via registered backend handler.
 * 5. Returns typed AgentLoopResult with full iteration history and execution records.
 */

import type {
  AgentLoopConfig,
  AgentLoopIteration,
  AgentLoopResult,
  AgentLoopStopReason,
  AgentToolExecutionRecord,
  ToolCallProposal,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@nomaanos/nexus-shared-types';
import { ToolRegistry } from './tool-registry.js';
import { executeTool } from './tool-executor.js';
import { getModelRouter } from '../inference/index.js';
import { pool } from '../../database/pool.js';
import { logger } from '../../config/logger.js';

export interface RunAgentLoopOptions {
  query: string;
  context: ToolExecutionContext;
  config?: AgentLoopConfig;
  systemPrompt?: string;
  registry?: ToolRegistry;
  modelPolicy?: string;
  assistantName?: string;
}

/**
 * Extracts tool proposals from model output. Supports:
 * 1. JSON object containing a `tool_calls` array: `{ "tool_calls": [{ "name": "...", "arguments": {...} }] }`
 * 2. Markdown fenced JSON block: ```json { "tool_calls": [...] } ```
 * 3. Single tool action: `{ "action": "...", "arguments": {...} }` or `{ "tool": "...", "arguments": {...} }`
 */
export function extractToolProposals(text: string): {
  proposals: ToolCallProposal[];
  cleanText: string;
} {
  const proposals: ToolCallProposal[] = [];
  let cleanText = text;

  // 1. Check for markdown code blocks containing json
  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    const rawJson = match[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.tool_calls)) {
          for (const tc of parsed.tool_calls) {
            if (tc && typeof tc.name === 'string') {
              proposals.push({
                callId: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                toolName: tc.name,
                arguments: typeof tc.arguments === 'object' && tc.arguments !== null ? tc.arguments : {},
              });
            }
          }
        } else if (typeof parsed.tool === 'string' || typeof parsed.action === 'string') {
          const toolName = parsed.tool || parsed.action;
          proposals.push({
            callId: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            toolName,
            arguments: typeof parsed.arguments === 'object' && parsed.arguments !== null ? parsed.arguments : {},
          });
        }
      }
    } catch {
      // Not valid json block, ignore
    }
  }

  // 2. If no proposals in code blocks, attempt parsing full text as JSON
  if (proposals.length === 0) {
    try {
      const parsed = JSON.parse(text.trim());
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.tool_calls)) {
          for (const tc of parsed.tool_calls) {
            if (tc && typeof tc.name === 'string') {
              proposals.push({
                callId: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                toolName: tc.name,
                arguments: typeof tc.arguments === 'object' && tc.arguments !== null ? tc.arguments : {},
              });
            }
          }
        } else if (typeof parsed.tool === 'string' || typeof parsed.action === 'string') {
          const toolName = parsed.tool || parsed.action;
          proposals.push({
            callId: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            toolName,
            arguments: typeof parsed.arguments === 'object' && parsed.arguments !== null ? parsed.arguments : {},
          });
        }
      }
    } catch {
      // Regular conversational text
    }
  }

  return { proposals, cleanText };
}

/**
 * Builds the tool description prompt instructing the model how to propose registered tools.
 */
function buildToolsInstruction(tools: { name: string; description: string; parameters: any }[]): string {
  if (tools.length === 0) {
    return 'No tools are currently authorized for this session. Provide direct responses without tool calls.';
  }

  const toolSummaries = tools
    .map(
      (t) =>
        `- Tool "${t.name}": ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`
    )
    .join('\n\n');

  return `
### Available Authorized Tools
You have access to the following strictly approved backend tools:
${toolSummaries}

### Tool Calling Protocol
When you need to execute a tool, reply ONLY with a JSON object in a \`\`\`json\`\`\` code block with the following schema:
\`\`\`json
{
  "thought": "Brief explanation of why this tool is needed",
  "tool_calls": [
    {
      "name": "tool_name",
      "arguments": { "param1": "value" }
    }
  ]
}
\`\`\`
If you do not need to call a tool, respond directly with your final answer in plain text.
Never invent or propose tools outside the authorized list above.
`;
}

/**
 * Executes a controlled, bounded agent loop.
 */
export async function runControlledAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const {
    query,
    context,
    config: userConfig,
    systemPrompt: customSystemPrompt,
    registry = ToolRegistry.getInstance(),
    modelPolicy,
    assistantName = 'Nexus Assistant',
  } = options;

  const startTime = Date.now();
  const maxIterations = Math.min(Math.max(userConfig?.maxIterations ?? 5, 1), 10);
  const maxToolCalls = Math.min(Math.max(userConfig?.maxToolCalls ?? 10, 1), 20);
  const perToolTimeoutMs = userConfig?.perToolTimeoutMs ?? 5000;
  const overallTimeoutMs = userConfig?.overallTimeoutMs ?? 30000;
  const allowedToolsFilter = userConfig?.allowedTools;

  // Retrieve authorized tools for caller role
  const allTools = registry.listTools({ role: context.role, enabledOnly: true });
  const filteredTools = allowedToolsFilter
    ? allTools.filter((t) => allowedToolsFilter.includes(t.name))
    : allTools;

  const toolsPrompt = buildToolsInstruction(filteredTools);
  const baseSystemPrompt = [
    `You are ${assistantName}, a security-conscious enterprise AI assistant for NomaanOS.`,
    customSystemPrompt,
    toolsPrompt,
  ]
    .filter(Boolean)
    .join('\n\n');

  const iterations: AgentLoopIteration[] = [];
  let totalToolCalls = 0;
  let stopReason: AgentLoopStopReason = 'completed';
  let finalResponse = '';

  // Setup overall timeout controller
  const overallAbort = new AbortController();
  const overallTimer = setTimeout(() => {
    overallAbort.abort(new Error(`Overall agent loop timed out after ${overallTimeoutMs}ms`));
  }, overallTimeoutMs);

  const onParentAbort = () => {
    overallAbort.abort(context.signal?.reason || new Error('Request cancelled by caller'));
  };

  if (context.signal) {
    context.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const router = getModelRouter();
  const conversationMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
    { role: 'user', content: query },
  ];

  try {
    for (let iter = 1; iter <= maxIterations; iter++) {
      const iterStartTime = Date.now();

      // Check timeout or cancellation before iteration
      if (overallAbort.signal.aborted || context.signal?.aborted) {
        stopReason = overallAbort.signal.aborted ? 'timeout' : 'cancelled';
        finalResponse = `Agent loop stopped: ${stopReason === 'timeout' ? 'Overall execution timeout reached' : 'Request was cancelled'}.`;
        break;
      }

      // Check tool call budget
      if (totalToolCalls >= maxToolCalls) {
        stopReason = 'max_tool_calls_reached';
        finalResponse = `Agent loop stopped: Maximum allowed tool calls (${maxToolCalls}) reached.`;
        break;
      }

      // Compose prompt for the iteration
      const recentObservations = conversationMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

      // Call Inference Model
      let modelOutput = '';
      try {
        const genRes = await router.route({
          prompt: recentObservations,
          systemPrompt: baseSystemPrompt,
          signal: overallAbort.signal,
          routingPolicy: modelPolicy as any,
          workspaceId: context.workspaceId,
          assistantId: context.assistantId,
          conversationId: context.conversationId,
        });
        modelOutput = genRes.content.trim();
      } catch (err: any) {
        if (overallAbort.signal.aborted || context.signal?.aborted) {
          stopReason = overallAbort.signal.aborted ? 'timeout' : 'cancelled';
          finalResponse = `Agent loop stopped: ${err.message}`;
          break;
        }
        stopReason = 'tool_failure';
        finalResponse = `Model inference error during agent loop: ${err.message}`;
        break;
      }

      // Extract tool call proposals
      const { proposals } = extractToolProposals(modelOutput);

      // If model proposed no tools, loop completes
      if (proposals.length === 0) {
        stopReason = 'completed';
        finalResponse = modelOutput;
        iterations.push({
          iteration: iter,
          modelResponse: modelOutput,
          toolProposals: [],
          toolResults: [],
          durationMs: Date.now() - iterStartTime,
        });
        break;
      }

      // Model proposed tool calls: check budget
      const remainingCalls = maxToolCalls - totalToolCalls;
      const proposalsToExecute = proposals.slice(0, remainingCalls);
      const results: ToolExecutionResult[] = [];

      for (const proposal of proposalsToExecute) {
        if (overallAbort.signal.aborted || context.signal?.aborted) {
          stopReason = overallAbort.signal.aborted ? 'timeout' : 'cancelled';
          break;
        }

        const toolRes = await executeTool({
          proposal,
          context: {
            ...context,
            signal: overallAbort.signal,
          },
          registry,
          timeoutMs: perToolTimeoutMs,
        });

        results.push(toolRes);
        totalToolCalls++;

        // If a tool encountered cancellation or timeout, abort loop
        if (toolRes.status === 'timed_out' || toolRes.status === 'cancelled') {
          stopReason = toolRes.status === 'timed_out' ? 'timeout' : 'cancelled';
          break;
        }
      }

      iterations.push({
        iteration: iter,
        modelResponse: modelOutput,
        toolProposals: proposalsToExecute,
        toolResults: results,
        durationMs: Date.now() - iterStartTime,
      });

      if (stopReason === 'timeout' || stopReason === 'cancelled') {
        finalResponse = `Agent loop terminated prematurely due to ${stopReason}.`;
        break;
      }

      // Format observation results into conversation for the next model turn
      const observationText = results
        .map((r) => {
          const body = r.status === 'success' ? JSON.stringify(r.output) : `Error: ${r.error}`;
          return `[Tool Result for "${r.toolName}" (${r.status})]: ${body}`;
        })
        .join('\n');

      conversationMessages.push({ role: 'assistant', content: modelOutput });
      conversationMessages.push({
        role: 'user',
        content: `Observations:\n${observationText}\n\nBased on these observations, continue towards answering the initial inquiry: "${query}".`,
      });

      // If this was the last iteration and no final answer was produced
      if (iter === maxIterations) {
        stopReason = 'max_iterations_reached';
        finalResponse = `Agent reached maximum permitted iterations (${maxIterations}). Last observation: ${results[results.length - 1]?.output ? JSON.stringify(results[results.length - 1].output) : 'none'}.`;
      }
    }
  } finally {
    clearTimeout(overallTimer);
    if (context.signal) {
      context.signal.removeEventListener('abort', onParentAbort);
    }
  }

  const totalDurationMs = Date.now() - startTime;

  // Retrieve tool execution records from database for this request correlation
  let records: AgentToolExecutionRecord[] = [];
  try {
    if (context.correlationId) {
      const recRes = await pool.query(
        `SELECT id, workspace_id, user_id, assistant_id, conversation_id,
                tool_name, status, duration_ms, correlation_id,
                sanitized_arguments, output_summary, error_code, error_message, created_at
         FROM tool_execution_records
         WHERE correlation_id = $1 AND workspace_id = $2
         ORDER BY created_at ASC;`,
        [context.correlationId, context.workspaceId]
      );
      records = recRes.rows.map((r: any) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        userId: r.user_id,
        assistantId: r.assistant_id,
        conversationId: r.conversation_id,
        toolName: r.tool_name,
        status: r.status,
        durationMs: r.duration_ms,
        correlationId: r.correlation_id,
        sanitizedArguments: r.sanitized_arguments || {},
        outputSummary: r.output_summary,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        createdAt: r.created_at?.toISOString() || new Date().toISOString(),
      }));
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to fetch tool execution records for agent loop result');
  }

  return {
    finalResponse,
    iterations,
    totalToolCalls,
    totalDurationMs,
    stopReason,
    records,
  };
}

