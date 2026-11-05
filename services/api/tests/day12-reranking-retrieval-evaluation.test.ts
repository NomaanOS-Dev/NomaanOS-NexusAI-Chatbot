/**
 * NomaanOS Nexus AI - Day 12 Integration Test Suite
 *
 * Comprehensive automated verification for:
 * 1. Mathematical Information Retrieval Metrics: Recall@K, Precision@K, MRR, nDCG@K.
 * 2. Configurable Reranker Engine: Local cross-encoder and heuristic fallback strategies.
 * 3. Provenance & Metadata Preservation: Zero data loss during candidate reranking.
 * 4. Hybrid Search Reranking Integration: Expanded candidate pool and rerank ranking assignment.
 * 5. Retrieval Evaluation Benchmark Dataset: Standardized test cases across error codes, APIs, and multi-part questions.
 * 6. Access Control Evaluation: Tenant boundary isolation and superseded version chunk exclusion.
 * 7. RBAC & Direct Router Endpoints: Role enforcement (Analyst+ for evaluation, Viewer+ for rerank/search).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import {
  calculateRecallAtK,
  calculatePrecisionAtK,
  calculateReciprocalRank,
  calculateNDCGAtK,
  loadEvaluationDataset,
  runRetrievalEvaluation,
} from '../src/services/retrieval-evaluation.js';
import { rerankCandidates, scoreHeuristicCross } from '../src/services/reranker.js';
import { HybridSearchResultItem } from '../src/services/rrf.js';

describe('Day 12 — Reranking and Retrieval Evaluation Suite', () => {
  const app = createApp();

  const userAEmail = `day12-lead-${crypto.randomUUID().slice(0, 8)}@nexus-ai.io`;
  const userBEmail = `day12-viewer-${crypto.randomUUID().slice(0, 8)}@external-tenant.io`;
  const password = 'Day12SecurePassword!';

  let userAToken: string;
  let userBToken: string;

  let workspaceAId: string;
  let workspaceBId: string;

  let spaceAId: string;
  let sourceAId: string;
  let versionAId: string;

  beforeAll(async () => {
    // 1. Register User A in Workspace A (Admin / Lead)
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 12 Lead Evaluator',
        organizationName: 'Nexus Evaluation Labs',
      });
    expect(regARes.status).toBe(201);
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B in Workspace B (Foreign Tenant)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Foreign Tenant User',
        organizationName: 'Isolated Workspace Corp',
      });
    expect(regBRes.status).toBe(201);
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create active Knowledge Space in Workspace A
    const spaceRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Evaluation Benchmark Knowledge Space',
        slug: `eval-benchmark-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Target knowledge space for Day 12 reranker and retrieval benchmarking.',
      });
    expect(spaceRes.status).toBe(201);
    spaceAId = spaceRes.body.knowledgeSpace.id;

    // 4. Ingest Knowledge Document into Space A using upload endpoint
    const docContent = `# Platform Architecture & Troubleshooting Runbook

## Error Codes and Networking
Error code ERR_NEXUS_CONN_REFUSED indicates that the upstream gRPC broker refused connection on port 9443 due to exhausted worker pool.
If elevated latencies occur on node-prod-42, initiate failover to node-prod-43.

## Authentication and Tokens
Endpoint POST /api/v1/auth/tokens/revoke terminates an active bearer session and blacklists the token across distributed Redis nodes within 50ms.
When client tokens expire after the 15-minute TTL, the auth service returns ERR_AUTH_EXPIRED.
For federated access, OAuth 2.1 with mTLS mutual authentication is strictly enforced.

## Infrastructure and Telemetry
All cluster nodes emit OpenTelemetry traces to hostname telemetry.internal.nomaanos.ai over mTLS port 4317 with mandatory TLS 1.3 ciphers.
The Kafka broker is reachable at kafka-broker-01.internal on port 9092.`;

    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
      .set('Authorization', `Bearer ${userAToken}`)
      .field('title', 'Platform Troubleshooting Runbook')
      .attach('file', Buffer.from(docContent, 'utf-8'), 'platform-runbook.md');

    expect(uploadRes.status).toBe(201);
    sourceAId = uploadRes.body.source.id;
  }, 30000);

  afterAll(async () => {
    try {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2);', [userAEmail, userBEmail]);
    } catch {}
  });

  // =========================================================================
  // 1. Pure Mathematical Retrieval Evaluation Metrics
  // =========================================================================

  describe('1. Retrieval Evaluation Metrics (Recall, Precision, MRR, nDCG)', () => {
    it('calculates Recall@K accurately across perfect, partial, and zero retrieval', () => {
      const relevant = ['c1', 'c2', 'c3'];

      // Perfect recall: all 3 relevant retrieved within top 5
      expect(calculateRecallAtK(['c1', 'c2', 'c3', 'c4', 'c5'], relevant, 5)).toBe(1.0);

      // Partial recall: 2 of 3 relevant retrieved within top 3
      expect(calculateRecallAtK(['c1', 'c4', 'c2'], relevant, 3)).toBeCloseTo(2 / 3, 4);

      // Zero recall: no relevant items retrieved
      expect(calculateRecallAtK(['c9', 'c8', 'c7'], relevant, 3)).toBe(0.0);

      // Empty relevant ground truth returns 1.0 (no false negatives)
      expect(calculateRecallAtK(['c1'], [], 5)).toBe(1.0);

      // Empty retrieved items returns 0.0
      expect(calculateRecallAtK([], relevant, 5)).toBe(0.0);
    });

    it('calculates Precision@K accurately bounded between 0.0 and 1.0', () => {
      const relevant = ['c1', 'c2'];

      // 2 relevant out of top 2 = 1.0
      expect(calculatePrecisionAtK(['c1', 'c2'], relevant, 2)).toBe(1.0);

      // 1 relevant out of top 2 = 0.5
      expect(calculatePrecisionAtK(['c1', 'c9'], relevant, 2)).toBe(0.5);

      // 1 relevant out of top 5 = 0.2
      expect(calculatePrecisionAtK(['c1', 'c8', 'c7', 'c6', 'c5'], relevant, 5)).toBe(0.2);

      // 0 relevant out of top 5 = 0.0
      expect(calculatePrecisionAtK(['c9', 'c8', 'c7', 'c6', 'c5'], relevant, 5)).toBe(0.0);
    });

    it('calculates Mean Reciprocal Rank (MRR) for first relevant hit', () => {
      const relevant = ['c_target'];

      // Target at Rank 1 => RR = 1 / 1 = 1.0
      expect(calculateReciprocalRank(['c_target', 'c2', 'c3'], relevant, 3)).toBe(1.0);

      // Target at Rank 2 => RR = 1 / 2 = 0.5
      expect(calculateReciprocalRank(['c1', 'c_target', 'c3'], relevant, 3)).toBe(0.5);

      // Target at Rank 3 => RR = 1 / 3 = 0.3333
      expect(calculateReciprocalRank(['c1', 'c2', 'c_target'], relevant, 3)).toBeCloseTo(1 / 3, 4);

      // Target not found within K => RR = 0.0
      expect(calculateReciprocalRank(['c1', 'c2', 'c3'], relevant, 3)).toBe(0.0);
    });

    it('calculates normalized Discounted Cumulative Gain (nDCG@K)', () => {
      // Relevance grades: c1 = 3 (perfect), c2 = 2 (good), c3 = 1 (fair)
      const grades = { c1: 3, c2: 2, c3: 1 };

      // Ideal ranking [c1, c2, c3] gives nDCG@3 = 1.0
      const idealRanking = ['c1', 'c2', 'c3'];
      expect(calculateNDCGAtK(idealRanking, grades, 3)).toBe(1.0);

      // Inverted ranking [c3, c2, c1] gives strictly less than 1.0
      const invertedRanking = ['c3', 'c2', 'c1'];
      const invertedNDCG = calculateNDCGAtK(invertedRanking, grades, 3);
      expect(invertedNDCG).toBeLessThan(1.0);
      expect(invertedNDCG).toBeGreaterThan(0.0);

      // Zero relevant items returns 0.0
      expect(calculateNDCGAtK(['x1', 'x2'], grades, 2)).toBe(0.0);
    });
  });

  // =========================================================================
  // 2. Modular Reranker Service (Heuristic & Cross-Encoder)
  // =========================================================================

  describe('2. Modular Reranker Service & Strategy Execution', () => {
    it('scores technical queries with high discrimination using heuristic cross-scoring', () => {
      const query = 'ERR_NEXUS_CONN_REFUSED port 9443';
      const exactDoc = 'Encountered error code ERR_NEXUS_CONN_REFUSED when binding to port 9443 on cluster startup.';
      const irrelevantDoc = 'User interface dark mode theme preferences are saved in browser local storage.';

      const exactScore = scoreHeuristicCross(query, exactDoc);
      const irrevScore = scoreHeuristicCross(query, irrelevantDoc);

      expect(exactScore).toBeGreaterThanOrEqual(0.70);
      expect(irrevScore).toBe(0.0);
    });

    it('reranks candidate chunks preserving all metadata, token count, and source provenance', async () => {
      const candidates: HybridSearchResultItem[] = [
        {
          chunkId: 'chunk-general',
          content: 'General cluster configuration options and worker pool parameters.',
          rrfScore: 0.030,
          similarityScore: 0.75,
          keywordScore: 0.60,
          rankings: { rrfRank: 1, semanticRank: 1, keywordRank: 1 },
          source: { id: sourceAId, title: 'Platform Runbook', filename: 'runbook.txt', versionNumber: 1 },
          provenance: { sectionPath: 'Config', pageNumber: 1, sourceOffset: 0, chunkIndex: 0 },
          tokenCount: 40,
          metadata: { product: 'Nexus' },
        },
        {
          chunkId: 'chunk-exact-error',
          content: 'Critical error ERR_NEXUS_CONN_REFUSED port 9443 exhaustion in gRPC worker.',
          rrfScore: 0.015,
          similarityScore: 0.68,
          keywordScore: 0.50,
          rankings: { rrfRank: 2, semanticRank: 2, keywordRank: 2 },
          source: { id: sourceAId, title: 'Platform Runbook', filename: 'runbook.txt', versionNumber: 1 },
          provenance: { sectionPath: 'Troubleshooting', pageNumber: 2, sourceOffset: 120, chunkIndex: 1 },
          tokenCount: 35,
          metadata: { product: 'Nexus' },
        },
      ];

      const query = 'How do I fix ERR_NEXUS_CONN_REFUSED on port 9443?';
      const rerankResult = await rerankCandidates(query, candidates, { strategy: 'heuristic', topK: 2 });

      expect(rerankResult.results.length).toBe(2);
      // Exact error chunk should be promoted to Rank 1
      expect(rerankResult.results[0].chunkId).toBe('chunk-exact-error');
      expect(rerankResult.results[0].rankings.rerankRank).toBe(1);
      expect(rerankResult.results[0].rerankScore).toBeGreaterThan(rerankResult.results[1].rerankScore!);

      // Verify complete preservation of provenance and metadata
      expect(rerankResult.results[0].source.versionNumber).toBe(1);
      expect(rerankResult.results[0].provenance.sectionPath).toBe('Troubleshooting');
      expect(rerankResult.results[0].tokenCount).toBe(35);
      expect(rerankResult.results[0].metadata.product).toBe('Nexus');
    });

    it('safely handles empty candidate lists without throwing errors', async () => {
      const rerankResult = await rerankCandidates('some query', [], { topK: 5 });
      expect(rerankResult.results).toEqual([]);
      expect(rerankResult.totalCandidates).toBe(0);
    });
  });

  // =========================================================================
  // 3. API Endpoints: Rerank Candidate API
  // =========================================================================

  describe('3. Rerank API Endpoints (POST /rerank)', () => {
    it('reranks candidate chunks via Workspace Router (POST /api/v1/workspaces/:ws/knowledge-spaces/:ks/rerank)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/rerank`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'telemetry.internal.nomaanos.ai port 4317',
          strategy: 'heuristic',
          candidates: [
            {
              id: 'c-auth',
              content: 'Authentication token revocation endpoint details.',
              score: 0.02,
            },
            {
              id: 'c-telemetry',
              content: 'Traces are delivered to telemetry.internal.nomaanos.ai over port 4317 mTLS.',
              score: 0.01,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.results.length).toBe(2);
      expect(res.body.results[0].chunkId).toBe('c-telemetry');
      expect(res.body.strategyUsed).toBe('heuristic');
    });

    it('reranks candidate chunks via Direct Router (POST /api/v1/knowledge-spaces/:ks/rerank)', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${spaceAId}/rerank`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'ERR_NEXUS_CONN_REFUSED',
          strategy: 'heuristic',
          candidates: [
            {
              id: 'c-unrelated',
              content: 'Unrelated database migration documentation.',
            },
            {
              id: 'c-error',
              content: 'Handling ERR_NEXUS_CONN_REFUSED when broker connections drop.',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.results[0].chunkId).toBe('c-error');
    });

    it('rejects unauthenticated requests to rerank endpoint with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${spaceAId}/rerank`)
        .send({
          query: 'test',
          candidates: [{ content: 'test content' }],
        });

      expect(res.status).toBe(401);
    });

    it('rejects unauthorized foreign workspace users with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/rerank`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          query: 'test',
          candidates: [{ content: 'test content' }],
        });

      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 4. Hybrid Search with Reranking Enabled
  // =========================================================================

  describe('4. Hybrid Search Integration with Reranking', () => {
    it('executes hybrid search with rerank=true returning reranked scores and ranks', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/search`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          query: 'ERR_NEXUS_CONN_REFUSED port 9443 exhausted',
          searchMode: 'hybrid',
          rerank: true,
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.rerankApplied).toBe(true);
      expect(Array.isArray(res.body.results)).toBe(true);

      if (res.body.results.length > 0) {
        const topResult = res.body.results[0];
        expect(topResult.rankings.rerankRank).toBe(1);
        expect(typeof topResult.rerankScore).toBe('number');
      }
    });
  });

  // =========================================================================
  // 5. Evaluation Dataset & Benchmark Service
  // =========================================================================

  describe('5. Retrieval Evaluation Benchmark Dataset', () => {
    it('loads the standardized versioned evaluation dataset (version 1.0.0)', () => {
      const dataset = loadEvaluationDataset();

      expect(dataset.version).toBe('1.0.0');
      expect(Array.isArray(dataset.benchmarkQueries)).toBe(true);
      expect(dataset.benchmarkQueries.length).toBeGreaterThanOrEqual(10);
      expect(Array.isArray(dataset.accessControlTestCases)).toBe(true);
      expect(dataset.accessControlTestCases.length).toBeGreaterThanOrEqual(2);

      // Verify representation of exact technical query types
      const categories = new Set(dataset.benchmarkQueries.map((q) => q.category));
      expect(categories.has('exact_lookup')).toBe(true);
      expect(categories.has('knowledge_question')).toBe(true);
      expect(categories.has('unsupported')).toBe(true);
      expect(dataset.benchmarkQueries.some((q) => q.isMultiPart)).toBe(true);
    });

    it('runs retrieval evaluation comparing baseline vs reranked retrieval', async () => {
      const report = await runRetrievalEvaluation({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        k: 5,
        strategy: 'heuristic',
      });

      expect(report.datasetVersion).toBe('1.0.0');
      expect(report.k).toBe(5);
      expect(report.queryCount).toBeGreaterThanOrEqual(10);

      // Verify baseline vs reranked metric structures
      expect(typeof report.baseline.meanRecallAtK).toBe('number');
      expect(typeof report.baseline.meanPrecisionAtK).toBe('number');
      expect(typeof report.baseline.meanMRR).toBe('number');
      expect(typeof report.baseline.meanNDCGAtK).toBe('number');

      expect(typeof report.reranked.meanRecallAtK).toBe('number');
      expect(typeof report.reranked.meanPrecisionAtK).toBe('number');
      expect(typeof report.reranked.meanMRR).toBe('number');
      expect(typeof report.reranked.meanNDCGAtK).toBe('number');

      // Verify deltas
      expect(typeof report.deltas.mrrDelta).toBe('number');
      expect(typeof report.deltas.ndcgDelta).toBe('number');
      expect(typeof report.deltas.precisionDelta).toBe('number');

      // Verify access control evaluation
      expect(report.accessControl.totalSecurityTests).toBeGreaterThanOrEqual(2);
      expect(report.accessControl.crossTenantLeakedChunks).toBe(0);
      expect(report.accessControl.supersededChunksLeaked).toBe(0);
      expect(report.accessControl.authorizationCorrectnessPercent).toBe(100);
    });
  });

  // =========================================================================
  // 6. Evaluation Execution API Endpoints (POST /evaluation/run)
  // =========================================================================

  describe('6. Evaluation Execution API Endpoints & RBAC Enforcement', () => {
    it('executes evaluation run via Workspace Router (Analyst+)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/evaluation/run`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          strategy: 'heuristic',
          kValues: [5],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.datasetVersion).toBe('1.0.0');
      expect(res.body.accessControl.authorizationCorrectnessPercent).toBe(100);
    });

    it('executes evaluation run via Direct Router (POST /api/v1/knowledge-spaces/:ks/evaluation/run)', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${spaceAId}/evaluation/run`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          strategy: 'heuristic',
          kValues: [3],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.k).toBe(3);
    });

    it('strictly forbids foreign tenant user from running evaluation on another workspace space', async () => {
      const res = await request(app)
        .post(`/api/v1/knowledge-spaces/${spaceAId}/evaluation/run`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          strategy: 'heuristic',
        });

      expect([403, 404]).toContain(res.status);
    });
  });
});
