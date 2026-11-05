import { Router, Request, Response } from 'express';
import { checkDatabaseConnection, checkPgVectorAvailable } from '../database/pool.js';
import { config } from '../config/env.js';

export const healthRouter = Router();

// Liveness probe: returns immediately to indicate the Node.js event loop is healthy
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'nexus-ai-api',
    timestamp: new Date().toISOString(),
    offline: {
      enabled: config.offline.enabled,
      airGapped: config.offline.enabled,
      remoteDataAvailable: config.offline.remoteDataEnabled,
    },
  });
});

// Readiness probe: verifies downstream dependencies (PostgreSQL + pgvector)
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [dbCheck, vectorCheck] = await Promise.all([
    checkDatabaseConnection(2000),
    checkPgVectorAvailable(2000),
  ]);

  const isReady = dbCheck.ok && vectorCheck.ok;

  if (!isReady) {
    res.status(503).json({
      status: 'unavailable',
      checks: {
        database: dbCheck.ok ? 'ok' : 'failed',
        pgvector: vectorCheck.ok ? 'ok' : 'failed',
      },
      latencyMs: dbCheck.latencyMs,
      error: dbCheck.error || vectorCheck.error,
      offline: {
        enabled: config.offline.enabled,
        airGapped: config.offline.enabled,
        remoteDataAvailable: config.offline.remoteDataEnabled,
      },
    });
    return;
  }

  res.status(200).json({
    status: 'ready',
    checks: {
      database: 'ok',
      pgvector: 'ok',
    },
    latencyMs: dbCheck.latencyMs,
    offline: {
      enabled: config.offline.enabled,
      airGapped: config.offline.enabled,
      remoteDataAvailable: config.offline.remoteDataEnabled,
    },
  });
});

