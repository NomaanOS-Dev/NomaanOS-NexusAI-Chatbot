import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { requestLogger, correlationIdMiddleware } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { workspacesRouter } from './routes/workspaces.js';
import { applicationsRouter } from './routes/applications.js';
import { assistantsRouter, publicAssistantsRouter } from './routes/assistants.js';
import { knowledgeSpacesRouter, directKnowledgeSpacesRouter } from './routes/knowledge-spaces.js';
import { credentialsRouter } from './routes/credentials.js';
import { conversationsRouter } from './routes/conversations.js';
import { knowledgeSourcesRouter } from './routes/knowledge-sources.js';
import { ingestionJobsRouter, internalIngestionRouter } from './routes/ingestion-jobs.js';
import { preferencesRouter, retentionRouter } from './routes/preferences.js';
import { inferenceRouter } from './routes/inference.js';
import { offlineRouter } from './routes/offline.js';
import { toolsRouter, agentRouter } from './routes/tools.js';

export function createApp(): Express {
  const app = express();

  // Bounded JSON body parser (2MB max)
  app.use(express.json({ limit: '2mb' }));

  // Cookie parser for session tokens
  app.use(cookieParser());

  // Security headers & CORS middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Workspace-Id, X-Requested-With, X-Anonymous-Session-Token, Accept, X-Idempotency-Key'
      );
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, X-Correlation-Id');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  // Correlation ID and structured request logger
  app.use(correlationIdMiddleware);
  app.use(requestLogger);

  // Health and readiness routes
  app.use('/', healthRouter);

  // Serve static widget bundle if built (for direct script tag embed)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const widgetDistCandidate1 = path.resolve(process.cwd(), 'packages/widget/dist');
  const widgetDistCandidate2 = path.resolve(__dirname, '../../../packages/widget/dist');
  const widgetDistCandidate3 = path.resolve(__dirname, '../../packages/widget/dist');
  const widgetDistPath = [widgetDistCandidate1, widgetDistCandidate2, widgetDistCandidate3].find(p => fs.existsSync(p));
  if (widgetDistPath) {
    app.use('/widget', express.static(widgetDistPath));
  }

  // Core Authentication routes (/api/v1/auth)
  app.use('/api/v1/auth', authRouter);

  // Workspace-scoped sub-routers
  // Must be mounted before or alongside workspacesRouter
  app.use('/api/v1/workspaces/:workspaceId/applications', applicationsRouter);
  app.use('/api/v1/workspaces/:workspaceId/assistants', assistantsRouter);
  app.use('/api/v1/workspaces/:workspaceId/knowledge-spaces', knowledgeSpacesRouter);
  app.use('/api/v1/workspaces/:workspaceId/credentials', credentialsRouter);

  // Workspace management & membership routes
  app.use('/api/v1/workspaces', workspacesRouter);

  // Public / Cross-cutting assistant endpoints (e.g. widget config)
  app.use('/api/v1/assistants', publicAssistantsRouter);

  // Conversation lifecycle & streaming chat endpoints
  app.use('/api/v1/conversations', conversationsRouter);

  // Knowledge source registration, secure upload, and extraction endpoints
  app.use('/api/v1/knowledge-sources', knowledgeSourcesRouter);
  app.use('/api/v1/sources', knowledgeSourcesRouter);

  // Direct Knowledge Space endpoints (e.g. semantic search)
  app.use('/api/v1/knowledge-spaces', directKnowledgeSpacesRouter);

  // User preferences (e.g. /api/v1/users/me/preferences)
  app.use('/api/v1/users', preferencesRouter);

  // Workspace retention policies (e.g. /api/v1/workspaces/:workspaceId/retention)
  app.use('/api/v1/workspaces', retentionRouter);

  // Local model inference & health (Day 16 & Day 17)
  app.use('/api/v1/inference', inferenceRouter);

  // Offline operations & knowledge package transfer (Day 18)
  app.use('/api/v1/offline', offlineRouter);

  // Tool Registry, execution, and bounded agent loop (Day 19)
  app.use('/api/v1/tools', toolsRouter);
  app.use('/api/v1/agent', agentRouter);

  // Durable background ingestion & synchronization jobs
  app.use('/api/v1/ingestion-jobs', ingestionJobsRouter);

  // Internal worker communication endpoints (authenticated via x-internal-key)
  app.use('/api/v1/internal/ingestion', internalIngestionRouter);

  // 404 catch-all for unmatched routes
  app.use((_req, res) => {
    res.status(404).json({
      error: 'NotFound',
      message: 'The requested API route does not exist.',
      statusCode: 404,
    });
  });

  // Central sanitized error handler
  app.use(errorHandler);

  return app;
}
