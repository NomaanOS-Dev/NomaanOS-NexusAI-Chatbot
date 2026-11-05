/**
 * Day 14 Integration Tests: Citations, Claim Validation, and Contradictory Documents
 *
 * Verifies:
 * 1. Backend-derived citation generation with rich provenance (title, version, section, page).
 * 2. Citation validation: Rejection of fabricated and inaccessible citations.
 * 3. Answer sanitization: Stripping invalid/fabricated bracketed citations.
 * 4. Claim-support validation: Computing lexical overlap and qualifying ungrounded statements.
 * 5. Contradiction detection: Catching version discrepancies, deprecation signals, and technical mismatches.
 * 6. Tool-execution verification: Refusing to claim success without verified backend execution.
 * 7. End-to-end conversation flow with rich citations and verification status.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { AssembledEvidenceItem } from '../src/services/evidence-assembler.js';
import { GroundedCitation, synthesizeGroundedAnswer } from '../src/services/grounded-generator.js';
import { validateCitations, sanitizeAnswerCitations } from '../src/services/citation-validator.js';
import { detectContradictions } from '../src/services/contradiction-detector.js';
import { validateClaimSupport, calculateClaimOverlap } from '../src/services/claim-validator.js';
import { verifyToolExecution, recordToolExecution } from '../src/services/tool-verifier.js';

const app = createApp();

describe('Day 14 - Citations, Claim Validation, and Contradictory Documents', () => {
  let workspaceId: string;
  let foreignWorkspaceId: string;
  let knowledgeSpaceId: string;
  let assistantId: string;
  let documentSourceId: string;
  let versionId: string;
  let chunkId1: string;
  let chunkId2: string;
  let archivedSourceId: string;
  let archivedChunkId: string;

  let userToken: string;

  beforeAll(async () => {
    // 1. Register primary tenant
    const primaryEmail = `day14-tester-${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: primaryEmail,
        password: 'Password123!',
        fullName: 'Day 14 Governance Admin',
        organizationName: 'Day 14 Governance Org',
      });
    userToken = regRes.body.token;
    workspaceId = regRes.body.workspace.id;

    // 2. Register foreign tenant (for cross-workspace isolation tests)
    const foreignEmail = `day14-foreign-${Date.now()}@example.com`;
    const foreignRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: foreignEmail,
        password: 'Password123!',
        fullName: 'Day 14 Foreign Admin',
        organizationName: 'Day 14 Foreign Org',
      });
    foreignWorkspaceId = foreignRes.body.workspace.id;

    // 3. Setup knowledge space
    const ksRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Day 14 Knowledge Space',
        slug: `day14-ks-${Date.now()}`,
      });
    knowledgeSpaceId = ksRes.body.knowledgeSpace.id;

    // 4. Setup assistant
    const asstRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/assistants`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Nexus Governance Copilot',
        assistantKey: `governance-day14-${Date.now()}`,
        systemPrompt: 'You are the Nexus Governance Copilot.',
        publicEmbedAllowed: true,
      });
    assistantId = asstRes.body.assistant.id;

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/knowledge-spaces/${knowledgeSpaceId}/assistants/${assistantId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send();

    // 5. Setup active document source and version
    const dsRes = await pool.query(`
      INSERT INTO document_sources (
        workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status
      ) VALUES ($1, $2, 'Firewall Policy Runbook', 'firewall-policy.md', 'text/markdown', 1024, '/tmp/firewall.md', 'sha256-day14-test-hash', 'ready')
      RETURNING id;
    `, [workspaceId, knowledgeSpaceId]);
    documentSourceId = dsRes.rows[0].id;

    const dvRes = await pool.query(`
      INSERT INTO document_versions (source_id, version_number, sha256, status, is_current)
      VALUES ($1, 2, 'sha256-day14-test-hash', 'active', TRUE)
      RETURNING id;
    `, [documentSourceId]);
    versionId = dvRes.rows[0].id;

    await pool.query(`
      UPDATE document_sources SET current_version_id = $1 WHERE id = $2;
    `, [versionId, documentSourceId]);

    // 6. Setup active chunks with section path and page numbers
    const c1Res = await pool.query(`
      INSERT INTO document_chunks (
        workspace_id, knowledge_space_id, source_id, version_id, chunk_index,
        content, section_path, page_number, is_active
      ) VALUES ($1, $2, $3, $4, 0, 'SSH port 22 is strictly restricted to bastion hosts with MFA enabled.', 'Network Security > Ingress', 4, TRUE)
      RETURNING id;
    `, [workspaceId, knowledgeSpaceId, documentSourceId, versionId]);
    chunkId1 = c1Res.rows[0].id;

    const c2Res = await pool.query(`
      INSERT INTO document_chunks (
        workspace_id, knowledge_space_id, source_id, version_id, chunk_index,
        content, section_path, page_number, is_active
      ) VALUES ($1, $2, $3, $4, 1, 'Cluster alpha telemetry reports zero unauthorized root escalations in the last 24 hours.', 'Audit Log > Cluster Alpha', 12, TRUE)
      RETURNING id;
    `, [workspaceId, knowledgeSpaceId, documentSourceId, versionId]);
    chunkId2 = c2Res.rows[0].id;

    // 7. Setup archived (inaccessible) source and chunk
    const archDsRes = await pool.query(`
      INSERT INTO document_sources (
        workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status
      ) VALUES ($1, $2, 'Archived Legacy Architecture', 'legacy-arch.md', 'text/markdown', 512, '/tmp/legacy.md', 'sha256-archived-hash', 'archived')
      RETURNING id;
    `, [workspaceId, knowledgeSpaceId]);
    archivedSourceId = archDsRes.rows[0].id;

    const archDvRes = await pool.query(`
      INSERT INTO document_versions (source_id, version_number, sha256, status, is_current)
      VALUES ($1, 1, 'sha256-archived-hash', 'archived', FALSE)
      RETURNING id;
    `, [archivedSourceId]);

    const archCRes = await pool.query(`
      INSERT INTO document_chunks (
        workspace_id, knowledge_space_id, source_id, version_id, chunk_index,
        content, is_active
      ) VALUES ($1, $2, $3, $4, 0, 'Legacy port 8080 unencrypted plaintext communications.', FALSE)
      RETURNING id;
    `, [workspaceId, knowledgeSpaceId, archivedSourceId, archDvRes.rows[0].id]);
    archivedChunkId = archCRes.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup workspaces
    if (workspaceId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    }
    if (foreignWorkspaceId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [foreignWorkspaceId]);
    }
  });

  // =========================================================================
  // 1. Citation Generation & Provenance
  // =========================================================================
  describe('Citation Generation & Provenance', () => {
    it('generates citations with backend-supplied metadata, section paths, and page numbers', () => {
      const evidenceItems: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: chunkId1,
          sourceId: documentSourceId,
          sourceTitle: 'Firewall Policy Runbook',
          filename: 'firewall-policy.md',
          versionNumber: 2,
          sectionPath: 'Network Security > Ingress',
          pageNumber: 4,
          sourceOffset: 120,
          tokenCount: 45,
          relevanceScore: 0.95,
          content: 'SSH port 22 is strictly restricted to bastion hosts with MFA enabled.',
          truncated: false,
        },
      ];

      const res = synthesizeGroundedAnswer({
        query: 'What are the rules for SSH port 22?',
        evidenceResult: {
          items: evidenceItems,
          totalTokens: 45,
          totalChunks: 1,
          candidateCount: 1,
          deduplicatedCount: 0,
          excludedPermissionCount: 0,
          insufficientEvidence: false,
        },
        assistantName: 'Governance Copilot',
      });

      expect(res.citations.length).toBe(1);
      const cit = res.citations[0];
      expect(cit.citationIndex).toBe(1);
      expect(cit.sourceId).toBe(documentSourceId);
      expect(cit.chunkId).toBe(chunkId1);
      expect(cit.sourceTitle).toBe('Firewall Policy Runbook');
      expect(cit.versionNumber).toBe(2);
      expect(cit.sectionPath).toBe('Network Security > Ingress');
      expect(cit.pageNumber).toBe(4);
      expect(res.answer).toContain('[1]');
      expect(res.answer).toContain('Firewall Policy Runbook');
      expect(res.answer).toContain('(v2)');
      expect(res.answer).toContain('(Section: Network Security > Ingress)');
      expect(res.answer).toContain('(p. 4)');
    });
  });

  // =========================================================================
  // 2. Citation Validation: Fabrications & Inaccessible Sources
  // =========================================================================
  describe('Citation Validation & Sanitization', () => {
    it('rejects fabricated citations not present in retrieved evidence', async () => {
      const evidenceItems: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: chunkId1,
          sourceId: documentSourceId,
          sourceTitle: 'Firewall Policy Runbook',
          filename: 'firewall-policy.md',
          versionNumber: 2,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 30,
          relevanceScore: 0.9,
          content: 'SSH port 22 is restricted.',
          truncated: false,
        },
      ];

      // Model hallucinated citation [99] with fake chunk ID
      const candidateCitations: GroundedCitation[] = [
        {
          citationIndex: 1,
          chunkId: chunkId1,
          sourceId: documentSourceId,
          sourceTitle: 'Firewall Policy Runbook',
          excerpt: 'SSH port 22 is restricted.',
          relevanceScore: 0.9,
        },
        {
          citationIndex: 99,
          chunkId: crypto.randomUUID(), // Fabricated chunk ID
          sourceId: crypto.randomUUID(), // Fabricated source ID
          sourceTitle: 'Hallucinated Database Spec',
          excerpt: 'Invented security policy.',
          relevanceScore: 0.99,
        },
      ];

      const validation = await validateCitations({
        citations: candidateCitations,
        assembledEvidence: evidenceItems,
        workspaceId,
        answerText: 'According to [1] SSH is secured. However [99] states something else.',
      });

      expect(validation.hasFabrications).toBe(true);
      expect(validation.validCitations.length).toBe(1);
      expect(validation.validCitations[0].citationIndex).toBe(1);
      expect(validation.validCitations[0].validationStatus).toBe('verified');
      expect(validation.validCitations[0].sourceUrl).toBe(`/api/v1/workspaces/${workspaceId}/sources/${documentSourceId}`);

      expect(validation.rejectedCitations.length).toBe(1);
      expect(validation.rejectedCitations[0].citationIndex).toBe(99);
      expect(validation.rejectedCitations[0].validationStatus).toBe('fabricated');

      // Sanitized answer text must strip the fabricated citation [99]
      expect(validation.sanitizedAnswer).toContain('[1]');
      expect(validation.sanitizedAnswer).not.toContain('[99]');
    });

    it('rejects citations for archived or cross-tenant inaccessible documents', async () => {
      const evidenceItems: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: archivedChunkId,
          sourceId: archivedSourceId,
          sourceTitle: 'Archived Legacy Architecture',
          filename: 'legacy-arch.md',
          versionNumber: 1,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 20,
          relevanceScore: 0.7,
          content: 'Legacy port 8080 communications.',
          truncated: false,
        },
      ];

      const citations: GroundedCitation[] = [
        {
          citationIndex: 1,
          chunkId: archivedChunkId,
          sourceId: archivedSourceId,
          sourceTitle: 'Archived Legacy Architecture',
          excerpt: 'Legacy port 8080 communications.',
          relevanceScore: 0.7,
        },
      ];

      // Test with primary workspace (source is archived)
      const resArchived = await validateCitations({
        citations,
        assembledEvidence: evidenceItems,
        workspaceId,
      });

      expect(resArchived.hasInaccessible).toBe(true);
      expect(resArchived.validCitations.length).toBe(0);
      expect(resArchived.rejectedCitations[0].validationStatus).toBe('inaccessible');

      // Test with foreign workspace (tenant boundary violation)
      const resForeign = await validateCitations({
        citations: [
          {
            citationIndex: 1,
            chunkId: chunkId1, // valid in primary workspace, but inaccessible to foreign workspace
            sourceId: documentSourceId,
            sourceTitle: 'Firewall Policy Runbook',
            excerpt: 'SSH port 22 is restricted.',
            relevanceScore: 0.9,
          },
        ],
        assembledEvidence: [
          {
            citationIndex: 1,
            chunkId: chunkId1,
            sourceId: documentSourceId,
            sourceTitle: 'Firewall Policy Runbook',
            filename: 'firewall-policy.md',
            versionNumber: 2,
            sectionPath: null,
            pageNumber: null,
            sourceOffset: null,
            tokenCount: 20,
            relevanceScore: 0.9,
            content: 'SSH port 22 is restricted.',
            truncated: false,
          },
        ],
        workspaceId: foreignWorkspaceId,
      });

      expect(resForeign.validCitations.length).toBe(0);
      expect(resForeign.rejectedCitations[0].validationStatus).toBe('inaccessible');
    });

    it('sanitizes answer text by removing invalid citation tags', () => {
      const rawText = 'Passage confirms standard operations [1] and references unverified doc [5] and [12].';
      const validIndices = new Set([1]);
      const sanitized = sanitizeAnswerCitations(rawText, validIndices);

      expect(sanitized).toBe('Passage confirms standard operations [1] and references unverified doc and .');
    });
  });

  // =========================================================================
  // 3. Claim-Support Validation
  // =========================================================================
  describe('Claim-Support Validation', () => {
    it('calculates token overlap accurately between claim and evidence', () => {
      const claim = 'SSH port 22 is strictly restricted to bastion hosts.';
      const evidence = 'SSH port 22 is strictly restricted to bastion hosts with MFA enabled.';
      const overlap = calculateClaimOverlap(claim, evidence);
      expect(overlap).toBeGreaterThanOrEqual(0.85);

      const unrelatedClaim = 'Kubernetes nodes run Redis in-memory cache on port 6379.';
      const lowOverlap = calculateClaimOverlap(unrelatedClaim, evidence);
      expect(lowOverlap).toBeLessThan(0.2);
    });

    it('identifies and qualifies unsupported claims in assistant answers', () => {
      const evidenceItems: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: chunkId1,
          sourceId: documentSourceId,
          sourceTitle: 'Firewall Policy Runbook',
          filename: 'firewall-policy.md',
          versionNumber: 2,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 20,
          relevanceScore: 0.9,
          content: 'SSH port 22 is strictly restricted to bastion hosts with MFA enabled.',
          truncated: false,
        },
      ];

      const answerWithHallucination = [
        'As the **Governance Copilot**, I retrieved relevant documentation:',
        '',
        '- SSH port 22 is strictly restricted to bastion hosts [1]',
        '- All database passwords are automatically rotated every five minutes [1]', // Unsupported assertion citing [1]
        '',
        '**Verified Sources**:',
        '[1] **Firewall Policy Runbook** (v2)',
      ].join('\n');

      const result = validateClaimSupport(answerWithHallucination, [] as any, evidenceItems, 0.4);

      expect(result.hasUnsupportedClaims).toBe(true);
      expect(result.evaluatedClaims.length).toBe(2);
      expect(result.evaluatedClaims[0].isSupported).toBe(true);
      expect(result.evaluatedClaims[1].isSupported).toBe(false);
      expect(result.qualifiedAnswer).toContain('Grounding & Evidence Limitation');
      expect(result.qualifiedAnswer).toContain('All database passwords are automatically rotated every five minutes');
      expect(result.qualifiedAnswer).toContain('Incomplete or unverified claims must not be treated as confirmed operational facts');
    });
  });

  // =========================================================================
  // 4. Contradictory & Outdated Document Detection
  // =========================================================================
  describe('Contradictory and Outdated Documents', () => {
    it('detects multiple version discrepancies of the same document', () => {
      const items: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: 'chunk-v1',
          sourceId: 'doc-source-100',
          sourceTitle: 'Kubernetes Ingress Architecture',
          filename: 'k8s.md',
          versionNumber: 1,
          sectionPath: 'Overview',
          pageNumber: 1,
          sourceOffset: 0,
          tokenCount: 30,
          relevanceScore: 0.9,
          content: 'Ingress controller uses NodePort routing.',
          truncated: false,
        },
        {
          citationIndex: 2,
          chunkId: 'chunk-v2',
          sourceId: 'doc-source-100',
          sourceTitle: 'Kubernetes Ingress Architecture',
          filename: 'k8s.md',
          versionNumber: 2,
          sectionPath: 'Overview',
          pageNumber: 1,
          sourceOffset: 0,
          tokenCount: 30,
          relevanceScore: 0.95,
          content: 'Ingress controller uses LoadBalancer with Envoy proxy.',
          truncated: false,
        },
      ];

      const contradictions = detectContradictions(items);
      expect(contradictions.hasContradictions).toBe(true);
      expect(contradictions.conflicts.length).toBe(1);
      expect(contradictions.conflicts[0].conflictType).toBe('version_discrepancy');
      expect(contradictions.conflictNotice).toContain('multiple revisions (v1 and v2)');
      expect(contradictions.conflictNotice).toContain('Kubernetes Ingress Architecture');
    });

    it('detects deprecation vs active status conflicts across documents', () => {
      const items: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: 'chunk-legacy',
          sourceId: 'source-deprec',
          sourceTitle: 'Legacy Auth Gateway',
          filename: 'legacy.md',
          versionNumber: 1,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 35,
          relevanceScore: 0.85,
          content: 'The BasicAuth proxy gateway is deprecated, obsolete, and no longer supported.',
          truncated: false,
        },
        {
          citationIndex: 2,
          chunkId: 'chunk-standard',
          sourceId: 'source-active',
          sourceTitle: 'Current Auth Gateway',
          filename: 'current.md',
          versionNumber: 1,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 35,
          relevanceScore: 0.92,
          content: 'The BasicAuth proxy gateway is the active standard recommended for internal services.',
          truncated: false,
        },
      ];

      const contradictions = detectContradictions(items);
      expect(contradictions.hasContradictions).toBe(true);
      expect(contradictions.conflicts.some((c) => c.conflictType === 'deprecation_conflict')).toBe(true);
      expect(contradictions.conflictNotice).toContain('deprecation or obsolescence');
    });

    it('detects technical parameter mismatches (e.g. differing port numbers)', () => {
      const items: AssembledEvidenceItem[] = [
        {
          citationIndex: 1,
          chunkId: 'chunk-p22',
          sourceId: 'source-p22',
          sourceTitle: 'Standard Security Runbook',
          filename: 'sec.md',
          versionNumber: 1,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 20,
          relevanceScore: 0.9,
          content: 'Admin console operates on port 22.',
          truncated: false,
        },
        {
          citationIndex: 2,
          chunkId: 'chunk-p2222',
          sourceId: 'source-p2222',
          sourceTitle: 'Hardened Container Profile',
          filename: 'container.md',
          versionNumber: 1,
          sectionPath: null,
          pageNumber: null,
          sourceOffset: null,
          tokenCount: 20,
          relevanceScore: 0.9,
          content: 'Admin console operates on port 2222.',
          truncated: false,
        },
      ];

      const contradictions = detectContradictions(items);
      expect(contradictions.hasContradictions).toBe(true);
      expect(contradictions.conflicts.some((c) => c.conflictType === 'technical_mismatch')).toBe(true);
      expect(contradictions.conflictNotice).toContain('port 22');
      expect(contradictions.conflictNotice).toContain('port 2222');
    });
  });

  // =========================================================================
  // 5. Tool-Execution Verification
  // =========================================================================
  describe('Tool-Execution Verification', () => {
    it('refuses to claim success when tool execution is pending or unverified', () => {
      const resPending = verifyToolExecution(
        'restart_firewall_daemon',
        'pending',
        'Restart firewall daemon on worker node 01'
      );

      expect(resPending.isVerifiedSuccess).toBe(false);
      expect(resPending.status).toBe('pending');
      expect(resPending.verifiedStatement).toContain('has NOT been executed');
      expect(resPending.verifiedStatement).toContain('pending explicit confirmation and authorization');
      expect(resPending.verifiedStatement).toContain('No changes have been applied');

      const resUnverified = verifyToolExecution(
        'drop_database_table',
        'unverified',
        'Drop old telemetry table'
      );

      expect(resUnverified.isVerifiedSuccess).toBe(false);
      expect(resUnverified.status).toBe('unverified');
      expect(resUnverified.verifiedStatement).toContain('cannot be verified');
    });

    it('reports failure accurately without claiming state was altered', () => {
      const resFailed = verifyToolExecution(
        'scale_cluster',
        'failed',
        'Scale cluster alpha to 10 nodes',
        { error: 'Insufficient quota in us-central1' }
      );

      expect(resFailed.isVerifiedSuccess).toBe(false);
      expect(resFailed.status).toBe('failed');
      expect(resFailed.verifiedStatement).toContain('failed during execution');
      expect(resFailed.verifiedStatement).toContain('Insufficient quota in us-central1');
      expect(resFailed.verifiedStatement).toContain('The platform state remains unchanged');
    });

    it('confirms execution only when execution result is verified as success', () => {
      const resSuccess = verifyToolExecution(
        'rotate_api_key',
        'success',
        'Rotate API key for monitoring daemon',
        { output: { keyId: 'key-9021-rot', status: 'active' } }
      );

      expect(resSuccess.isVerifiedSuccess).toBe(true);
      expect(resSuccess.status).toBe('success');
      expect(resSuccess.verifiedStatement).toContain('successfully executed and verified against platform state');
      expect(resSuccess.verifiedStatement).toContain('key-9021-rot');
    });

    it('persists tool execution records to PostgreSQL table', async () => {
      // Create conversation
      const convRes = await pool.query(`
        INSERT INTO conversations (workspace_id, assistant_id, title)
        VALUES ($1, $2, 'Tool Verification Test')
        RETURNING id;
      `, [workspaceId, assistantId]);
      const convId = convRes.rows[0].id;

      const record = await recordToolExecution({
        conversationId: convId,
        toolName: 'apply_firewall_rule',
        executionStatus: 'success',
        inputArguments: { port: 22, protocol: 'tcp' },
        outputPayload: { ruleId: 'fw-rule-101', applied: true },
      });

      expect(record.id).toBeDefined();
      expect(record.status).toBe('success');
      expect(record.verifiedAt).toBeDefined();

      const dbCheck = await pool.query('SELECT * FROM tool_executions WHERE id = $1', [record.id]);
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].status).toBe('success');
      expect(dbCheck.rows[0].tool_name).toBe('apply_firewall_rule');
    });
  });

  // =========================================================================
  // 6. End-to-End API Integration
  // =========================================================================
  describe('End-to-End API Conversation Flow', () => {
    it('returns rich citations with validationStatus, sectionPath, and pageNumber via REST', async () => {
      // 1. Create conversation
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assistantId,
          title: 'Day 14 Citation Test',
        });

      expect(createRes.status).toBe(201);
      const convId = createRes.body.conversationId;

      // 2. Send message requesting information backed by knowledge space
      const msgRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('Accept', 'application/json')
        .send({
          content: 'What are the rules for SSH port 22?',
          stream: false,
          knowledgeSpaceIds: [knowledgeSpaceId],
        });

      expect(msgRes.status).toBe(200);
      expect(msgRes.body.assistantMessage).toBeDefined();
      expect(msgRes.body.citations).toBeDefined();
      expect(msgRes.body.citations.length).toBeGreaterThan(0);

      const firstCit = msgRes.body.citations[0];
      expect(firstCit.sourceTitle).toBe('Firewall Policy Runbook');
      expect(firstCit.versionNumber).toBe(2);
      expect(firstCit.sectionPath).toBe('Network Security > Ingress');
      expect(firstCit.pageNumber).toBe(4);
      expect(firstCit.validationStatus).toBe('verified');
      expect(firstCit.sourceUrl).toContain(`/api/v1/workspaces/${workspaceId}/sources/`);

      // 3. Verify message history endpoint exposes the new citation metadata
      const histRes = await request(app)
        .get(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(histRes.status).toBe(200);
      const asstHistory = histRes.body.messages.find((m: any) => m.role === 'assistant');
      expect(asstHistory.citations.length).toBeGreaterThan(0);
      expect(asstHistory.citations[0].validationStatus).toBe('verified');
      expect(asstHistory.citations[0].sectionPath).toBe('Network Security > Ingress');
      expect(asstHistory.citations[0].pageNumber).toBe(4);
      expect(asstHistory.citations[0].versionNumber).toBe(2);
    }, 45000);

    it('enforces that action-classified queries do not falsely claim success', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assistantId,
          title: 'Action Query Test',
        });

      const convId = createRes.body.conversationId;

      // Query classified as 'action'
      const msgRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('Accept', 'application/json')
        .send({
          content: 'Restart the firewall daemon now',
          stream: false,
        });

      expect(msgRes.status).toBe(200);
      const text = msgRes.body.assistantMessage.content;
      // Must not claim it succeeded
      expect(text).not.toContain('Successfully restarted');
      expect(text).not.toContain('I have restarted');
      // Must state pending confirmation
      expect(text).toContain('has NOT been executed');
      expect(text).toContain('pending explicit confirmation and authorization');
    });
  });
});
