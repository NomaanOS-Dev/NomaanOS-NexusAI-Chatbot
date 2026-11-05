/**
 * NomaanOS Nexus AI - Task Complexity Evaluator (Day 17)
 *
 * Classifies inference requests into 'simple', 'standard', or 'complex'
 * to enable intelligent model routing under 'hybrid' policy.
 */

import { config } from '../../config/env.js';
import type { GenerationRequest, TaskComplexity } from './types.js';

export interface TaskComplexityAnalysis {
  complexity: TaskComplexity;
  reason: string;
  estimatedPromptTokens: number;
  hasCode: boolean;
  hasIncidentKeywords: boolean;
}

const GREETING_REGEX = /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|who\s+are\s+you|help)\b/i;

const COMPLEX_KEYWORDS = [
  'root cause',
  'incident response',
  'threat model',
  'architecture comparison',
  'vulnerability analysis',
  'investigate anomaly',
  'security posture',
  'zero trust',
  'penetration test',
  'forensics',
  'siem telemetry',
  'multi-step',
  'remediate',
  'synthesize across',
  'compare and contrast',
];

export function evaluateTaskComplexity(request: GenerationRequest): TaskComplexityAnalysis {
  const prompt = (request.prompt || '').trim();
  const systemPrompt = (request.systemPrompt || '').trim();
  const combinedText = `${systemPrompt}\n${prompt}`;

  // 1. Estimated token count (~4 chars per token)
  const estimatedPromptTokens = Math.ceil(combinedText.length / 4);

  // 2. Check for code syntax / structured data
  const hasCode =
    /```[\s\S]*?```/.test(prompt) ||
    /(\bfunction\b|\bclass\b|\bSELECT\b[\s\S]+\bFROM\b|\bconst\b|\bdef\b|\bcurl\b|\bimport\b)/i.test(prompt);

  // 3. Check for deep security / architectural investigation keywords
  const promptLower = prompt.toLowerCase();
  const hasIncidentKeywords = COMPLEX_KEYWORDS.some((kw) => promptLower.includes(kw));

  // 4. Evaluate Thresholds & Classify
  const threshold = config.inference?.hybrid?.complexityTokenThreshold || 300;

  if (hasCode || hasIncidentKeywords || estimatedPromptTokens >= threshold) {
    let reason = 'High complexity task: ';
    if (hasCode) reason += 'contains code or structured technical syntax; ';
    if (hasIncidentKeywords) reason += 'requires deep security or incident reasoning; ';
    if (estimatedPromptTokens >= threshold) reason += `prompt length (${estimatedPromptTokens} tokens) exceeds hybrid threshold (${threshold}); `;

    return {
      complexity: 'complex',
      reason: reason.trim(),
      estimatedPromptTokens,
      hasCode,
      hasIncidentKeywords,
    };
  }

  // 5. Check for simple greetings or ultra-short lookups
  if (prompt.length < 50 && GREETING_REGEX.test(prompt)) {
    return {
      complexity: 'simple',
      reason: 'Low complexity task: conversational greeting or introductory prompt.',
      estimatedPromptTokens,
      hasCode: false,
      hasIncidentKeywords: false,
    };
  }

  if (estimatedPromptTokens < 40 && !prompt.includes('?') && !prompt.includes('\n')) {
    return {
      complexity: 'simple',
      reason: 'Low complexity task: short keyword lookup or single-phrase inquiry.',
      estimatedPromptTokens,
      hasCode: false,
      hasIncidentKeywords: false,
    };
  }

  // 6. Default standard
  return {
    complexity: 'standard',
    reason: 'Standard complexity: grounded factual question within normal token limits.',
    estimatedPromptTokens,
    hasCode: false,
    hasIncidentKeywords: false,
  };
}

