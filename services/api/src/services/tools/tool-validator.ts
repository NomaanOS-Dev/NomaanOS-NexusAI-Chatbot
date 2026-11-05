/**
/**
 * NomaanOS Nexus AI - Tool Argument & Output Validation (Day 19)
 *
 * Guarantees that:
 * 1. Model-proposed arguments conform strictly to the registered tool's input schema.
 * 2. Malformed arguments, missing required fields, out-of-bounds numbers, and extra fields are rejected.
 * 3. Tool results conform to expected output contracts.
 * 4. Sensitive credentials, tokens, and secrets are sanitized before logging or database recording.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolCallProposal } from '@nomaanos/nexus-shared-types';

export interface ValidationSuccess<T> {
  isValid: true;
  data: T;
  error?: undefined;
}

export interface ValidationFailure {
  isValid: false;
  data?: undefined;
  error: string;
  fieldErrors?: Record<string, string[]>;
}

export type ValidationOutcome<T> = ValidationSuccess<T> | ValidationFailure;

const SENSITIVE_KEY_REGEX = /(?:password|secret|token|apikey|api_key|auth|credential|authorization|private_key|privatekey|bearer|access_token|refresh_token)/i;
const SENSITIVE_VALUE_REGEX = /^(?:Bearer\s+[a-zA-Z0-9_\-\.]+|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{48}|ey[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,})$/;

/**
 * Recursively sanitizes arguments to ensure no credentials, tokens, or private secrets
 * are leaked into logs or stored in audit records.
 */
export function sanitizeToolArguments(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object') {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && SENSITIVE_VALUE_REGEX.test(value.trim())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null ? sanitizeToolArguments(item) : item
        );
      } else {
        result[key] = sanitizeToolArguments(value);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Validates a model-proposed tool call against the tool's registered input schema.
 */
export function validateToolProposal(
  proposal: ToolCallProposal,
  tool: ToolDefinition
): ValidationOutcome<Record<string, unknown>> {
  if (!proposal) {
    return {
      isValid: false,
      error: 'Tool proposal payload is null or undefined.',
    };
  }

  if (typeof proposal.toolName !== 'string' || proposal.toolName.trim() === '') {
    return {
      isValid: false,
      error: 'Tool call proposal must specify a non-empty toolName.',
    };
  }

  if (proposal.arguments === null || typeof proposal.arguments !== 'object' || Array.isArray(proposal.arguments)) {
    return {
      isValid: false,
      error: `Tool arguments for '${proposal.toolName}' must be a JSON object, received ${Array.isArray(proposal.arguments) ? 'array' : typeof proposal.arguments}.`,
    };
  }

  // If the tool defines a Zod input schema, execute strict validation
  if (tool.inputSchema) {
    const parseResult = tool.inputSchema.safeParse(proposal.arguments);
    if (!parseResult.success) {
      const issues = parseResult.error.issues;
      const formattedIssues = issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ');

      const fieldErrors: Record<string, string[]> = {};
      for (const issue of issues) {
        const path = issue.path.join('.') || 'root';
        if (!fieldErrors[path]) {
          fieldErrors[path] = [];
        }
        fieldErrors[path].push(issue.message);
      }

      return {
        isValid: false,
        error: `Argument schema validation failed for tool '${tool.name}': ${formattedIssues}`,
        fieldErrors,
      };
    }

    return {
      isValid: true,
      data: parseResult.data,
    };
  }

  return {
    isValid: true,
    data: proposal.arguments,
  };
}

/**
 * Validates the output returned by a tool handler against the tool's output schema.
 */
export function validateToolResult(
  output: unknown,
  tool: ToolDefinition
): ValidationOutcome<unknown> {
  if (tool.outputSchema) {
    const parseResult = tool.outputSchema.safeParse(output);
    if (!parseResult.success) {
      const formattedIssues = parseResult.error.issues
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; ');
      return {
        isValid: false,
        error: `Tool '${tool.name}' returned an output that violates its registered contract: ${formattedIssues}`,
      };
    }
    return {
      isValid: true,
      data: parseResult.data,
    };
  }

  return {
    isValid: true,
    data: output,
  };
}

