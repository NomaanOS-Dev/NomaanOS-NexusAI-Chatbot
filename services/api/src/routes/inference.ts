/**
 * NomaanOS Nexus AI - Inference & Model Routing API Routes (Day 16 & Day 17)
 *
 * Provides endpoints for:
 * 1. Provider health & capability inspection (GET /api/v1/inference/health).
 * 2. Available model discovery (GET /api/v1/inference/models).
 * 3. Policy-based model routing generation (POST /api/v1/inference/generate).
 * 4. Observability metrics & telemetry (GET /api/v1/inference/metrics).
 * 5. Supported routing policies inspection (GET /api/v1/inference/policies).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getModelRouter,
  ProviderRegistry,
  UsageTelemetryService,
  PolicyViolationError,
  RateLimitError,
} from '../services/inference/index.js';
import { config } from '../config/env.js';
import { optionalAuthenticate } from '../middleware/auth.js';

export const inferenceRouter = Router();

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(32000),
  systemPrompt: z.string().max(10000).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32768).optional(),
  format: z.enum(['text', 'json']).default('text'),
  provider: z.string().optional(),
  policy: z
    .enum(['local-only', 'cloud-preferred', 'hybrid', 'cloud-only', 'local_only', 'cloud_preferred', 'cloud_only'])
    .optional(),
  containsSensitiveData: z.boolean().optional(),
});

// 1. Model Health, Providers, and Capabilities
// GET /api/v1/inference/health
inferenceRouter.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const registry = ProviderRegistry.getInstance();
    const workspaceId = (req.query.workspaceId as string) || undefined;
    const providersHealth = await registry.checkAllHealth(workspaceId);

    const primaryHealth = providersHealth.find((p) => p.provider === 'ollama') || providersHealth[0];

    res.status(200).json({
      status: primaryHealth?.status || 'ready',
      provider: config.inference.provider,
      routingPolicy: config.inference.routingPolicy,
      localOnly: config.inference.localOnly,
      activeModel: config.inference.ollamaModel,
      currentModel: primaryHealth?.currentModel || config.inference.ollamaModel,
      availableModels: primaryHealth?.availableModels || [config.inference.ollamaModel],
      capabilities: primaryHealth?.capabilities || { streaming: true, jsonMode: true, contextLength: 4096 },
      providers: providersHealth,
      details: {
        baseUrl: config.inference.ollamaBaseUrl,
        keepAlive: config.inference.ollamaKeepAlive,
        timeoutMs: config.inference.ollamaTimeoutMs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 2. Available Models Discovery
// GET /api/v1/inference/models
inferenceRouter.get('/models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const registry = ProviderRegistry.getInstance();
    const workspaceId = (req.query.workspaceId as string) || undefined;
    const models = await registry.listAllModels(workspaceId);

    res.status(200).json({
      status: 'ok',
      count: models.length,
      policy: config.inference.routingPolicy,
      localOnly: config.inference.localOnly,
      models,
    });
  } catch (err) {
    next(err);
  }
});

// 3. Supported Routing Policies
// GET /api/v1/inference/policies
inferenceRouter.get('/policies', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    activePolicy: config.inference.routingPolicy,
    localOnlyEnforced: config.inference.localOnly,
    policies: [
      {
        id: 'local-only',
        name: 'Local Only',
        description: 'Zero external network transmission. All inference executed locally or via deterministic fallback.',
        cloudPermitted: false,
      },
      {
        id: 'cloud-preferred',
        name: 'Cloud Preferred',
        description: 'Prefers cloud inference when permitted and configured, with automatic local fallback on failure or rate-limit.',
        cloudPermitted: true,
      },
      {
        id: 'hybrid',
        name: 'Hybrid Routing',
        description: 'Dynamically routes requests based on task complexity (complex -> cloud, simple/standard -> local). Sensitive data stays local.',
        cloudPermitted: true,
      },
      {
        id: 'cloud-only',
        name: 'Cloud Only',
        description: 'Strictly executes via configured cloud provider. Rejects requests if cloud provider is unavailable or unconfigured.',
        cloudPermitted: true,
      },
    ],
  });
});

// 4. Observability Metrics & Telemetry
// GET /api/v1/inference/metrics
inferenceRouter.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const telemetry = UsageTelemetryService.getInstance();
    const workspaceId = (req.query.workspaceId as string) || undefined;
    const summary = await telemetry.getMetricsSummary(workspaceId);

    res.status(200).json({
      status: 'ok',
      metrics: summary,
    });
  } catch (err) {
    next(err);
  }
});

// 5. Policy-Based Inference Generation
// POST /api/v1/inference/generate
inferenceRouter.post(
  '/generate',
  optionalAuthenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = GenerateSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid generation payload',
          statusCode: 400,
          details: parse.error.issues,
        });
        return;
      }

      const {
        prompt,
        systemPrompt,
        model,
        temperature,
        maxTokens,
        format,
        provider,
        policy,
        containsSensitiveData,
      } = parse.data;

      const router = getModelRouter();

      const result = await router.route({
        prompt,
        systemPrompt,
        model,
        temperature,
        maxTokens,
        format: format === 'json' ? 'json' : undefined,
        forceProvider: provider,
        routingPolicy: policy as any,
        containsSensitiveData,
        workspaceId: req.workspace?.id || (req.headers['x-workspace-id'] as string),
      });

      res.status(200).json({
        status: 'ok',
        provider: result.provider || result.routingDecision.targetProvider,
        policyUsed: result.routingDecision.policy,
        model: result.model,
        result: {
          content: result.content,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          finishReason: result.finishReason,
          durationMs: result.durationMs,
          estimatedCostUsd: result.estimatedCostUsd,
        },
        routing: {
          decision: result.routingDecision,
          fallbackTriggered: result.fallbackTriggered || false,
          fallbackReason: result.fallbackReason,
        },
      });
    } catch (err: any) {
      if (err instanceof PolicyViolationError || err.statusCode === 403 || err.message?.includes('disabled')) {
        res.status(403).json({
          error: 'PolicyViolationError',
          message: err.message,
          statusCode: 403,
        });
        return;
      }

      if (err instanceof RateLimitError || err.statusCode === 429) {
        res.status(429).json({
          error: 'RateLimitError',
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds || 30,
          statusCode: 429,
        });
        return;
      }

      next(err);
    }
  }
);
