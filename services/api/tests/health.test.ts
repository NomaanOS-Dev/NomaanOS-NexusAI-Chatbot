import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('API Health and Readiness Endpoints', () => {
  const app = createApp();

  it('GET /health returns 200 OK with service identifier and timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('nexus-ai-api');
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  it('GET /ready returns 200 OK when PostgreSQL and pgvector are healthy', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks).toEqual({
      database: 'ok',
      pgvector: 'ok',
    });
    expect(res.body.latencyMs).toBeTypeOf('number');
  });

  it('GET /non-existent-route returns 404 with structured error', async () => {
    const res = await request(app).get('/api/v1/non-existent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
    expect(res.body.message).toContain('does not exist');
  });

  it('Injects X-Correlation-Id header in responses', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });
});

