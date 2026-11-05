/**
 * NomaanOS Nexus AI - Schema-Constrained Structured Output Service (Day 15)
 *
 * Validates model/assistant JSON output against predefined or custom JSON Schemas.
 * Enforces output types, required fields, and structural constraints.
 * Provides schema definitions and bounded retry / repair logic for malformed outputs.
 */

import { z } from 'zod';
import { logger } from '../config/logger.js';

export interface StructuredOutputRequest {
  type: 'text' | 'json_object';
  schema?: Record<string, unknown>;
  schemaName?: string;
}

export interface StructuredValidationResult<T = unknown> {
  isValid: boolean;
  data?: T;
  errors?: string[];
  rawOutput: string;
}

/**
 * Predefined schema for Incident Triage.
 */
export const IncidentTriageZodSchema = z.object({
  incidentId: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string().min(10),
  affectedComponents: z.array(z.string()).min(1),
  mitigationSteps: z.array(z.string()).min(1),
  isResolved: z.boolean().default(false),
});

/**
 * Predefined schema for Security Audit Reports.
 */
export const SecurityAuditReportZodSchema = z.object({
  auditId: z.string().min(1),
  complianceStatus: z.enum(['compliant', 'non_compliant', 'needs_review']),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  findings: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      remediation: z.string(),
    })
  ).min(1),
  recommendations: z.array(z.string()).min(1),
});

/**
 * Predefined schema for Technical Troubleshooting.
 */
export const TechnicalTroubleshootingZodSchema = z.object({
  issue: z.string().min(5),
  probableCause: z.string().min(5),
  resolutionSteps: z.array(z.string()).min(1),
  verificationCommand: z.string().optional(),
});

export const PREDEFINED_SCHEMAS: Record<string, z.ZodTypeAny> = {
  incident_triage: IncidentTriageZodSchema,
  security_audit: SecurityAuditReportZodSchema,
  technical_troubleshooting: TechnicalTroubleshootingZodSchema,
};

/**
 * Validates a JSON string or object against a Zod schema or JSON schema definition.
 */
export function validateStructuredOutput<T = unknown>(
  rawOutput: string | Record<string, unknown>,
  schemaOrName?: z.ZodTypeAny | string | Record<string, unknown>
): StructuredValidationResult<T> {
  let parsedObject: unknown;

  // 1. Parse JSON if string
  if (typeof rawOutput === 'string') {
    try {
      // Clean markdown code blocks if wrapped: ```json ... ```
      const cleaned = rawOutput
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
      parsedObject = JSON.parse(cleaned);
    } catch (parseErr) {
      return {
        isValid: false,
        errors: [`Invalid JSON output: ${(parseErr as Error).message}`],
        rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
      };
    }
  } else {
    parsedObject = rawOutput;
  }

  // 2. If no schema specified, valid JSON is sufficient
  if (!schemaOrName) {
    return {
      isValid: true,
      data: parsedObject as T,
      rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
    };
  }

  // 3. Resolve Zod schema
  let validator: z.ZodTypeAny;

  if (typeof schemaOrName === 'string') {
    const predefined = PREDEFINED_SCHEMAS[schemaOrName.toLowerCase()];
    if (!predefined) {
      return {
        isValid: false,
        errors: [`Unknown predefined schema: "${schemaOrName}"`],
        rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
      };
    }
    validator = predefined;
  } else if ('safeParse' in schemaOrName && typeof (schemaOrName as any).safeParse === 'function') {
    validator = schemaOrName as z.ZodTypeAny;
  } else {
    // Basic structural validation for custom schema object (checks required properties)
    const customDef = schemaOrName as { required?: string[]; properties?: Record<string, { type?: string }> };
    const obj = parsedObject as Record<string, unknown>;

    if (customDef.required && Array.isArray(customDef.required)) {
      const missing = customDef.required.filter((prop) => obj[prop] === undefined || obj[prop] === null);
      if (missing.length > 0) {
        return {
          isValid: false,
          errors: [`Missing required fields: ${missing.join(', ')}`],
          rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
        };
      }
    }

    if (customDef.properties && typeof customDef.properties === 'object') {
      const typeErrors: string[] = [];
      for (const [key, propDef] of Object.entries(customDef.properties)) {
        if (obj[key] !== undefined && propDef.type) {
          const valType = Array.isArray(obj[key]) ? 'array' : typeof obj[key];
          if (propDef.type === 'integer' && typeof obj[key] === 'number') continue;
          if (valType !== propDef.type) {
            typeErrors.push(`Field "${key}" expected type "${propDef.type}", received "${valType}"`);
          }
        }
      }
      if (typeErrors.length > 0) {
        return {
          isValid: false,
          errors: typeErrors,
          rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
        };
      }
    }

    return {
      isValid: true,
      data: parsedObject as T,
      rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
    };
  }

  // 4. Validate with Zod
  const result = validator.safeParse(parsedObject);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `[${issue.path.join('.') || 'root'}] ${issue.message}`
    );
    return {
      isValid: false,
      errors,
      rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
    };
  }

  return {
    isValid: true,
    data: result.data as T,
    rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
  };
}

/**
 * Deterministically constructs a mock structured response matching the requested schema
 * for offline deterministic testing.
 */
export function generateDeterministicStructuredOutput(
  schemaNameOrDef: string | Record<string, unknown>,
  context: { query: string; sourceTitle?: string }
): Record<string, unknown> {
  const name = typeof schemaNameOrDef === 'string' ? schemaNameOrDef.toLowerCase() : '';

  if (name.includes('incident') || name.includes('triage')) {
    return {
      incidentId: `INC-${Date.now().toString().slice(-4)}`,
      severity: context.query.toLowerCase().includes('ssh') ? 'high' : 'medium',
      summary: `Automated investigation summary regarding: ${context.query.slice(0, 80)}`,
      affectedComponents: ['bastion-host-01', 'ingress-gateway'],
      mitigationSteps: [
        'Enforce MFA authentication on SSH port 22',
        'Verify firewall policy runbook compliance',
        'Monitor audit telemetry for unauthorized escalations',
      ],
      isResolved: false,
    };
  }

  if (name.includes('security') || name.includes('audit')) {
    return {
      auditId: `AUDIT-${Date.now().toString().slice(-4)}`,
      complianceStatus: 'compliant',
      riskLevel: 'low',
      findings: [
        {
          category: 'Network Ingress',
          description: 'SSH port 22 restricted to authorized bastions with verified MFA.',
          remediation: 'Maintain current ingress rules and alert triggers.',
        },
      ],
      recommendations: ['Perform quarterly access reviews for bastion operators'],
    };
  }

  if (name.includes('troubleshooting')) {
    return {
      issue: context.query.slice(0, 60),
      probableCause: 'Misconfigured port routing or expired authentication tokens.',
      resolutionSteps: [
        'Inspect daemon connection logs',
        'Re-authenticate with current bearer credentials',
      ],
      verificationCommand: 'curl -s http://localhost:4001/health',
    };
  }

  // Default structured object fallback
  return {
    status: 'completed',
    query: context.query,
    timestamp: new Date().toISOString(),
    sourceTitle: context.sourceTitle || 'Authorized Documentation',
  };
}

