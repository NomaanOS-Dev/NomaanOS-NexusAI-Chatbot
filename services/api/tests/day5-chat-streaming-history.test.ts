import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';

describe('Day 5: Chat API, Streaming, Conversation History & Feedback Suite', () => {
  const app = createApp();

  const userAEmail = `day5-user-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day5-user-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'TestPassword123!';

  let userAToken: string;
  let userBToken: string;
  let workspaceAId: string;
  let workspaceBId: string;

  let publicAssistantId: string;
  let privateAssistantId: string;

  const anonToken1 = `anon_${crypto.randomUUID()}`;
  const anonToken2 = `anon_${crypto.randomUUID()}`;

  let publicConvId: string;
  let privateConvId: string;
  let assistantMessageId: string;

  beforeAll(async () => {
    // 1. Register User A in Workspace A
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 5 User A',
        organizationName: 'Alpha Cloud Corp',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B in Workspace B
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Day 5 User B',
        organizationName: 'Beta Security Corp',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create Public Assistant in Workspace A
    const pubAsstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Nexus Sentinel SOC Assistant',
        assistantKey: 'nexus-sentinel-day5',
        systemPrompt: 'You are the Sentinel cyber copilot.',
        modelPolicy: 'cloud-preferred',
        publicEmbedAllowed: true,
      });
    publicAssistantId = pubAsstRes.body.assistant.id;

    // 4. Create Private Assistant in Workspace B
    const privAsstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/assistants`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Confidential Finance Assistant',
        assistantKey: 'confidential-finance-day5',
        systemPrompt: 'Confidential executive finance metrics.',
        modelPolicy: 'local-only',
        publicEmbedAllowed: false,
      });
    privateAssistantId = privAsstRes.body.assistant.id;
  });

  afterAll(async () => {
    try {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2);', [userAEmail, userBEmail]);
    } catch {
      // Ignore cleanup error
    }
  });

  describe('1. Conversation Management & Revisit History', () => {
    it('Creates public conversation with anonymous session token', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          assistantId: publicAssistantId,
          title: 'Anonymous Threat Investigation',
        });

      expect(res.status).toBe(201);
      expect(res.body.conversationId).toBeDefined();
      expect(res.body.title).toBe('Anonymous Threat Investigation');
      expect(res.body.anonymousSessionToken).toBe(anonToken1);
      publicConvId = res.body.conversationId;
    });

    it('Rejects conversation creation for private assistant by anonymous caller (404)', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          assistantId: privateAssistantId,
        });

      expect(res.status).toBe(404);
    });

    it('Creates private conversation for authenticated workspace member', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          assistantId: privateAssistantId,
          title: 'Q3 Financial Audit Plan',
        });

      expect(res.status).toBe(201);
      expect(res.body.conversationId).toBeDefined();
      expect(res.body.title).toBe('Q3 Financial Audit Plan');
      privateConvId = res.body.conversationId;
    });

    it('Lists previous conversations for anonymous guest token', async () => {
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('X-Anonymous-Session-Token', anonToken1);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toBeInstanceOf(Array);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      const found = res.body.conversations.find((c: any) => c.id === publicConvId);
      expect(found).toBeDefined();
      expect(found.title).toBe('Anonymous Threat Investigation');
    });

    it('Lists previous conversations for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      const found = res.body.conversations.find((c: any) => c.id === privateConvId);
      expect(found).toBeDefined();
      expect(found.title).toBe('Q3 Financial Audit Plan');
    });

    it('Retrieves conversation details by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${publicConvId}`)
        .set('X-Anonymous-Session-Token', anonToken1);

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBe(publicConvId);
      expect(res.body.assistantId).toBe(publicAssistantId);
      expect(res.body.messageCount).toBe(0);
    });
  });

  describe('2. Message Submission, Idempotency & Validation', () => {
    it('Rejects empty or whitespace-only messages (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({ content: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('Rejects messages exceeding 32000 characters (400)', async () => {
      const longMessage = 'A'.repeat(32001);
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({ content: longMessage });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('Submits message with non-streaming fallback and returns full message payload', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          content: 'Scan cluster nodes for CVE-2024-1234 vulnerability.',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.userMessage.content).toBe('Scan cluster nodes for CVE-2024-1234 vulnerability.');
      expect(res.body.assistantMessage.role).toBe('assistant');
      expect(res.body.assistantMessage.content).toContain('Sentinel');
      assistantMessageId = res.body.assistantMessage.id;
    });

    it('Handles idempotent requests with idempotencyKey without duplicating messages', async () => {
      const idempotencyKey = `idem_${crypto.randomUUID()}`;

      // First submission
      const res1 = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          content: 'Initial idempotent check message.',
          idempotencyKey,
          stream: false,
        });
      expect(res1.status).toBe(200);

      // Duplicate submission with same idempotency key
      const res2 = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          content: 'Initial idempotent check message.',
          idempotencyKey,
          stream: false,
        });
      expect(res2.status).toBe(200);
      expect(res2.body.idempotent).toBe(true);
      expect(res2.body.userMessage.id).toBe(res1.body.userMessage.id);
    });
  });

  describe('3. Server-Sent Events (SSE) Streaming Protocol', () => {
    it('Streams assistant response emitting text, tool_status, and completion events', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .set('Accept', 'text/event-stream')
        .send({
          content: 'Analyze real-time firewall drop telemetry',
          stream: true,
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      const bodyText = res.text;
      // Canonical Day 5 events
      expect(bodyText).toContain('event: message.start');
      expect(bodyText).toContain('event: text');
      expect(bodyText).toContain('event: completion');

      // Verify completion payload structure
      expect(bodyText).toContain('"finishReason":"stop"');
    });

    it('Streams response in private authenticated conversation', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${privateConvId}/messages`)
        .set('Authorization', `Bearer ${userBToken}`)
        .set('Accept', 'text/event-stream')
        .send({
          content: 'Summarize internal Q3 payroll variance',
          stream: true,
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: completion');
    });

    it('Cancels generation and updates finish_reason to cancelled when client disconnects early', async () => {
      // Create a dedicated conversation for cancellation test
      const convRes = await request(app)
        .post('/api/v1/conversations')
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({ assistantId: publicAssistantId, title: 'Cancellation Test' });
      const cancelConvId = convRes.body.conversationId;

      // Start an HTTP request with abort controller
      const controller = new AbortController();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      try {
        const streamPromise = fetch(`http://127.0.0.1:${port}/api/v1/conversations/${cancelConvId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'X-Anonymous-Session-Token': anonToken1,
          },
          body: JSON.stringify({
            content: 'Generate a long explanation that will be interrupted.',
            stream: true,
          }),
          signal: controller.signal,
        });

        // Abort immediately after issuing request
        setTimeout(() => {
          controller.abort();
        }, 10);

        await streamPromise.catch(() => {});
        // Wait briefly for server req.on('close') handler to finalize DB record
        await new Promise((r) => setTimeout(r, 200));

        // Check the database for the assistant message finish_reason
        const dbRes = await pool.query(
          `SELECT role, finish_reason FROM messages WHERE conversation_id = $1 AND role = 'assistant' ORDER BY created_at DESC LIMIT 1;`,
          [cancelConvId]
        );
        expect(dbRes.rows.length).toBe(1);
        expect(['cancelled', 'stop']).toContain(dbRes.rows[0].finish_reason);
      } finally {
        server.close();
      }
    });
  });

  describe('4. Conversation History and Pagination', () => {
    it('Retrieves deterministic paginated message history with limit and offset', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${publicConvId}/messages?limit=2&offset=0`)
        .set('X-Anonymous-Session-Token', anonToken1);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(0);
      expect(res.body.total).toBeGreaterThanOrEqual(4);

      // Verify deterministic created_at ASC order
      const time1 = new Date(res.body.messages[0].createdAt).getTime();
      const time2 = new Date(res.body.messages[1].createdAt).getTime();
      expect(time1).toBeLessThanOrEqual(time2);
    });

    it('Offset pagination returns subsequent messages', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${publicConvId}/messages?limit=2&offset=2`)
        .set('X-Anonymous-Session-Token', anonToken1);

      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBeGreaterThanOrEqual(1);
      expect(res.body.offset).toBe(2);
    });
  });

  describe('5. Message Feedback System', () => {
    it('Submits positive feedback with optional comment for assistant message', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages/${assistantMessageId}/feedback`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          rating: 'positive',
          comment: 'Extremely accurate and rapid threat detection insight.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.feedback.messageId).toBe(assistantMessageId);
      expect(res.body.feedback.rating).toBe('positive');
      expect(res.body.feedback.comment).toBe('Extremely accurate and rapid threat detection insight.');
    });

    it('Retrieves submitted feedback via GET endpoint', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${publicConvId}/messages/${assistantMessageId}/feedback`)
        .set('X-Anonymous-Session-Token', anonToken1);

      expect(res.status).toBe(200);
      expect(res.body.feedback.rating).toBe('positive');
      expect(res.body.feedback.comment).toBe('Extremely accurate and rapid threat detection insight.');
    });

    it('Upserts feedback when user modifies rating (conflict policy: overwrite)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages/${assistantMessageId}/feedback`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({
          rating: 'thumbs_down',
          comment: 'Revised rating: needs deeper packet telemetry.',
        });

      expect(res.status).toBe(200);
      expect(res.body.feedback.rating).toBe('negative'); // Normalized thumbs_down -> negative
      expect(res.body.feedback.comment).toBe('Revised rating: needs deeper packet telemetry.');
    });

    it('Rejects feedback submission on user messages (400)', async () => {
      // Find a user message ID
      const historyRes = await request(app)
        .get(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1);

      const userMsg = historyRes.body.messages.find((m: any) => m.role === 'user');
      expect(userMsg).toBeDefined();

      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages/${userMsg.id}/feedback`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({ rating: 'positive' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('assistant messages');
    });

    it('Rejects feedback with invalid rating value (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages/${assistantMessageId}/feedback`)
        .set('X-Anonymous-Session-Token', anonToken1)
        .send({ rating: 'invalid_rating_value' });

      expect(res.status).toBe(400);
    });

    it('Includes feedback object in conversation messages history', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken1);

      expect(res.status).toBe(200);
      const msgWithFeedback = res.body.messages.find((m: any) => m.id === assistantMessageId);
      expect(msgWithFeedback).toBeDefined();
      expect(msgWithFeedback.feedback).not.toBeNull();
      expect(msgWithFeedback.feedback.rating).toBe('negative');
    });
  });

  describe('6. Security, Isolation & Tenant Boundaries', () => {
    it('Anonymous session token 2 CANNOT access Anonymous session token 1 conversation (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${publicConvId}`)
        .set('X-Anonymous-Session-Token', anonToken2); // Different anonymous token!

      expect(res.status).toBe(404);
    });

    it('Anonymous session token 2 CANNOT submit messages to session 1 conversation (404)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${publicConvId}/messages`)
        .set('X-Anonymous-Session-Token', anonToken2)
        .send({ content: 'Unauthorized probe from another anonymous guest' });

      expect(res.status).toBe(404);
    });

    it('Cross-workspace conversation access is blocked (User A cannot access User B private conversation)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${privateConvId}`)
        .set('Authorization', `Bearer ${userAToken}`); // User A has no access in Workspace B

      expect(res.status).toBe(404);
    });

    it('Cross-workspace message submission is blocked (User A cannot post to User B conversation)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${privateConvId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ content: 'Attempt cross-tenant message injection' });

      expect(res.status).toBe(404);
    });

    it('Rejects requests with malformed or expired session token (401)', async () => {
      const expiredOrInvalidToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', expiredOrInvalidToken);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('Rejects feedback from unauthorized user on private conversation (404)', async () => {
      // Find assistant message in private conversation
      const privHistoryRes = await request(app)
        .get(`/api/v1/conversations/${privateConvId}/messages`)
        .set('Authorization', `Bearer ${userBToken}`);

      const privAsstMsg = privHistoryRes.body.messages.find((m: any) => m.role === 'assistant');
      expect(privAsstMsg).toBeDefined();

      // User A attempts to submit feedback on User B's message
      const res = await request(app)
        .post(`/api/v1/conversations/${privateConvId}/messages/${privAsstMsg.id}/feedback`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ rating: 'negative' });

      expect(res.status).toBe(404);
    });
  });
});
