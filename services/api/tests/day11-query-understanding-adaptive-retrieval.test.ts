/**
 * NomaanOS Nexus AI - Day 11 Integration Test Suite
 *
 * Comprehensive automated verification for:
 * 1. Query Classification across 7 categories (greeting, knowledge_question, exact_lookup,
 *    live_data, action, ambiguous, unsupported).
 * 2. Conversational Query Rewriting & Technical Domain Expansion.
 * 3. Multi-Part Query Decomposition & Sub-Query Result Merging.
 * 4. Adaptive Retrieval with Bounded Retries & Insufficient Evidence Detection.
 * 5. Routing, Security, Tenant Isolation, and Live-Data / Action Guardrails.
 * 6. Conversations Chat Flow Integration & Message Metadata Provenance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import {
  classifyQuery,
  rewriteQuery,
  expandQuery,
  decomposeQuery,
  analyzeQuery,
} from '../src/services/query-understanding.js';

describe('Day 11 — Query Understanding and Adaptive Retrieval Suite', () => {
  const app = createApp();

  const userAEmail = `day11-user-a-${crypto.randomUUID().slice(0, 8)}@nexus-ai.io`;
  const userBEmail = `day11-user-b-${crypto.randomUUID().slice(0, 8)}@external-tenant.io`;
  const password = 'Day11SecurePassword!';

  let userAToken: string;
  let userBToken: string;

  let workspaceAId: string;
  let workspaceBId: string;

  let spaceAId: string;
  let assistantAId: string;
  let convAId: string;

  let sourceAId: string;

  beforeAll(async () => {
    // 1. Register User A in Workspace A
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 11 SecOps Lead',
        organizationName: 'SecOps Automated Corp',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B in Workspace B (Foreign Tenant)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Day 11 External Auditor',
        organizationName: 'External Tenant LLC',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create Knowledge Space A
    const spaceRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'SecOps Architecture & SRE Guides',
        slug: 'secops-sre-guides',
        description: 'Runbooks for Day 11 query understanding and adaptive retrieval',
      });
    spaceAId = spaceRes.body.knowledgeSpace.id;

    // 4. Create Assistant A linked to Knowledge Space A
    const asstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Sentinel SOC SRE Copilot',
        assistantKey: 'sentinel-soc-sre',
        systemPrompt: 'You are the Sentinel SRE Copilot specializing in incident response.',
        modelPolicy: 'cloud-preferred',
        publicEmbedAllowed: true,
      });
    assistantAId = asstRes.body.assistant.id;

    // Link Knowledge Space A to Assistant A
    await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/assistants/${assistantAId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send();

    // 5. Ingest Knowledge Document into Space A
    const docContent = `# Sentinel Incident & SRE Runbook

## Authentication Protocols & Error Codes
When client tokens expire after the 15-minute TTL, the auth service returns \`ERR_AUTH_EXPIRED\`.
Inspect authentication failures at endpoint \`/api/v1/auth/login\`.
For federated access, OAuth 2.1 with mTLS mutual authentication is strictly enforced.

## Cluster Node Topology & Incident Failover
Host \`node-prod-42\` operates as the primary ingress revalidation proxy.
If elevated latencies occur on \`node-prod-42\`, initiate failover to \`node-prod-43\`.
The Kafka broker is reachable at \`kafka-broker-01.internal\`.`;

    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
      .set('Authorization', `Bearer ${userAToken}`)
      .field('title', 'Sentinel Incident Runbook')
      .attach('file', Buffer.from(docContent, 'utf-8'), 'sentinel-incident-runbook.md');

    sourceAId = uploadRes.body.source.id;

    // 6. Create conversation for Assistant A
    const convRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        assistantId: assistantAId,
        title: 'Day 11 Query Understanding Investigation',
      });
    convAId = convRes.body.conversationId;
  }, 30000);

  afterAll(async () => {
    try {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2);', [userAEmail, userBEmail]);
    } catch {}
  });

  describe('1. Query Classification Engine (All 7 Categories)', () => {
    it('classifies conversational greetings correctly', () => {
      const greetings = ['Hello', 'Hi there', 'Good morning assistant', 'Hey nexus!'];
      for (const g of greetings) {
        const res = classifyQuery(g);
        expect(res.category).toBe('greeting');
        expect(res.route).toBe('conversation');
        expect(res.confidence).toBeGreaterThan(0.9);
      }
    });

    it('classifies exact technical lookups with high confidence', () => {
      const lookups = [
        'What causes ERR_AUTH_EXPIRED?',
        'Look up endpoint /api/v1/auth/login',
        'Show configuration for node-prod-42',
      ];
      for (const l of lookups) {
        const res = classifyQuery(l);
        expect(res.category).toBe('exact_lookup');
        expect(res.route).toBe('exact_retrieval');
      }
    });

    it('classifies knowledge questions as documentation inquiries', () => {
      const questions = [
        'How do I configure OAuth with mTLS mutual authentication?',
        'Explain the token expiration and TTL policies',
        'What is the failover strategy for ingress proxies?',
      ];
      for (const q of questions) {
        const res = classifyQuery(q);
        expect(res.category).toBe('knowledge_question');
        expect(res.route).toBe('retrieval');
      }
    });

    it('classifies live data & real-time telemetry requests', () => {
      const liveQueries = [
        'What is the current status of the database right now?',
        'Show live CPU load and memory metrics',
        'How many active users are connected currently?',
      ];
      for (const lq of liveQueries) {
        const res = classifyQuery(lq);
        expect(res.category).toBe('live_data');
        expect(res.route).toBe('live_integration');
      }
    });

    it('classifies action & mutation requests requiring confirmation', () => {
      const actions = [
        'Restart node-prod-42 immediately',
        'Deploy service to production cluster',
        'Revoke token for user bob',
      ];
      for (const act of actions) {
        const res = classifyQuery(act);
        expect(res.category).toBe('action');
        expect(res.route).toBe('action_tool');
      }
    });

    it('classifies ambiguous or underspecified queries', () => {
      const ambiguous = ['it failed', 'why?', 'fix it', 'help', '???', 'what happened?'];
      for (const amb of ambiguous) {
        const res = classifyQuery(amb);
        expect(res.category).toBe('ambiguous');
        expect(res.route).toBe('clarification');
        expect(res.clarificationPrompt).toBeDefined();
      }
    });

    it('classifies unsupported out-of-scope queries', () => {
      const unsupported = [
        'Write a poem about butterflies and stars',
        'Tell me a joke about dogs',
        'Who won the 1994 world cup?',
      ];
      for (const uns of unsupported) {
        const res = classifyQuery(uns);
        expect(res.category).toBe('unsupported');
        expect(res.route).toBe('unsupported_response');
      }
    });
  });

  describe('2. Query Rewriting and Controlled Domain Expansion', () => {
    it('rewrites conversational prefixes and strips filler phrases', () => {
      const query = 'Could you please tell me how to configure OAuth in Sentinel?';
      const rewritten = rewriteQuery(query);

      expect(rewritten.changesMade).toBe(true);
      expect(rewritten.rewrittenQuery).toBe('configure OAuth in Sentinel');
      expect(rewritten.originalQuery).toBe(query);
    });

    it('preserves clean search terms when no conversational fillers exist', () => {
      const query = 'ERR_AUTH_EXPIRED node-prod-42';
      const rewritten = rewriteQuery(query);

      expect(rewritten.changesMade).toBe(false);
      expect(rewritten.rewrittenQuery).toBe(query);
    });

    it('expands technical acronyms using controlled domain dictionary', () => {
      const query = 'Configure mTLS for SRE runbook';
      const expansion = expandQuery(query);

      expect(expansion.addedTerms).toContain('mutual');
      expect(expansion.addedTerms).toContain('TLS');
      expect(expansion.addedTerms).toContain('incident');
      expect(expansion.expandedQuery).toContain('mutual TLS');
    });

    it('avoids duplicate expansion when terms are already present', () => {
      const query = 'mTLS mutual TLS authentication';
      const expansion = expandQuery(query);

      // Should not redundantly duplicate 'mutual' or 'TLS'
      const words = expansion.expandedQuery.split(' ');
      const mutualCount = words.filter((w) => w.toLowerCase() === 'mutual').length;
      expect(mutualCount).toBe(1);
    });
  });

  describe('3. Query Decomposition for Multi-Part Questions', () => {
    it('detects and decomposes compound multi-part questions', () => {
      const compound = 'How do I configure OAuth AND what is the error code when it expires?';
      const decomposed = decomposeQuery(compound);

      expect(decomposed.isMultiPart).toBe(true);
      expect(decomposed.subQueries.length).toBe(2);
      expect(decomposed.subQueries[0]).toBe('How do I configure OAuth');
      expect(decomposed.subQueries[1]).toBe('what is the error code when it expires');
    });

    it('treats single focused questions as non-multipart', () => {
      const single = 'What is the host name for the ingress proxy?';
      const decomposed = decomposeQuery(single);

      expect(decomposed.isMultiPart).toBe(false);
      expect(decomposed.subQueries.length).toBe(1);
    });
  });

  describe('4. Adaptive Retrieval API & Bounded Retries', () => {
    it('executes adaptive search on exact technical lookup', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'ERR_AUTH_EXPIRED',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.classification.category).toBe('exact_lookup');
      expect(res.body.totalResults).toBeGreaterThan(0);
      expect(res.body.results[0].content).toContain('ERR_AUTH_EXPIRED');
      expect(res.body.attempts).toBe(1);
      expect(res.body.retried).toBe(false);
    });

    it('handles multi-part question with sub-query fusion and deduplication', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'How do I configure mTLS and what node operates as ingress proxy?',
          topK: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.isMultiPart).toBe(true);
      expect(res.body.subQueries.length).toBe(2);
      expect(res.body.totalResults).toBeGreaterThan(0);

      // Verify zero duplicate chunks
      const chunkIds = res.body.results.map((r: any) => r.chunkId);
      const uniqueChunkIds = new Set(chunkIds);
      expect(uniqueChunkIds.size).toBe(chunkIds.length);
    });

    it('triggers bounded retry and returns insufficient evidence for nonexistent knowledge', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'Quantum entanglement particle accelerator configuration manual',
          topK: 3,
          maxRetries: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.attempts).toBe(2); // Initial attempt + 1 bounded retry
      expect(res.body.retried).toBe(true);
      expect(res.body.insufficientEvidence).toBe(true);
      expect(res.body.totalResults).toBe(0);
      expect(res.body.routingAdvice.target).toBe('insufficient_evidence');
    });

    it('supports adaptive flag on standard POST /search endpoint', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'Could you please explain node-prod-42 failover?',
          adaptive: true,
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.classification).toBeDefined();
      expect(res.body.rewrittenQuery).toBe('explain node-prod-42 failover');
      expect(res.body.totalResults).toBeGreaterThan(0);
    });
  });

  describe('5. Non-Retrieval Routing Guardrails & Security', () => {
    it('bypasses retrieval completely for conversational greetings', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'Hello Nexus!',
        });

      expect(res.status).toBe(200);
      expect(res.body.classification.category).toBe('greeting');
      expect(res.body.attempts).toBe(0);
      expect(res.body.totalResults).toBe(0);
      expect(res.body.routingAdvice.target).toBe('conversation');
    });

    it('blocks live-data requests from fabricating false operational telemetry', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'What is the live CPU usage on node-prod-42 right now?',
        });

      expect(res.status).toBe(200);
      expect(res.body.classification.category).toBe('live_data');
      expect(res.body.attempts).toBe(0);
      expect(res.body.totalResults).toBe(0);
      expect(res.body.routingAdvice.target).toBe('live_integration');
      expect(res.body.routingAdvice.requiresLiveIntegration).toBe(true);
    });

    it('requires explicit confirmation before routing action / mutation requests', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'Restart node-prod-42 immediately',
        });

      expect(res.status).toBe(200);
      expect(res.body.classification.category).toBe('action');
      expect(res.body.attempts).toBe(0);
      expect(res.body.routingAdvice.target).toBe('action_tool');
      expect(res.body.routingAdvice.requiresConfirmation).toBe(true);
    });

    it('enforces strict cross-workspace tenant isolation on adaptive search (403 or 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userBToken}`) // Foreign user B
        .send({
          query: 'ERR_AUTH_EXPIRED',
        });

      expect([403, 404]).toContain(res.status);
    });

    it('enforces strict tenant isolation on standalone direct route (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${spaceAId}/adaptive-search`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          query: 'ERR_AUTH_EXPIRED',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('6. Conversations Chat Flow Integration & Provenance Metadata', () => {
    it('processes greeting message in chat conversation without citations', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${convAId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          content: 'Hello assistant!',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistantMessage.content).toContain('Hello!');
      expect(res.body.userMessage.metadata.queryUnderstanding.category).toBe('greeting');
      expect(res.body.citations).toEqual([]);
    });

    it('processes ambiguous query in chat by requesting clarification', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${convAId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          content: 'it failed',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistantMessage.content).toContain('clarify');
      expect(res.body.userMessage.metadata.queryUnderstanding.category).toBe('ambiguous');
      expect(res.body.citations).toEqual([]);
    });

    it('processes action request in chat requiring user confirmation', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${convAId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          content: 'Restart node-prod-42',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.assistantMessage.content).toContain('confirmation');
      expect(res.body.userMessage.metadata.queryUnderstanding.category).toBe('action');
      expect(res.body.citations).toEqual([]);
    });

    it('processes knowledge question in chat and returns verified citations', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${convAId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          content: 'What error code occurs when tokens expire after the TTL?',
          stream: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.userMessage.metadata.queryUnderstanding.category).toBe('knowledge_question');
      expect(res.body.citations.length).toBeGreaterThan(0);
      expect(res.body.citations[0].sourceTitle).toBe('Sentinel Incident Runbook');
      expect(res.body.assistantMessage.content).toContain('Sentinel');
    }, 45000);
  });
});
