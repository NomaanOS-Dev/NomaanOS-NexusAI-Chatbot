import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import {
  createIngestionJob,
  claimNextJob,
  completeJob,
  failOrRetryJob,
  retryFailedJob,
  cancelJob,
} from '../src/services/job-queue.js';
import { validateSafeUrl, SSRFViolationError } from '../src/connectors/ssrf-guard.js';
import { GitConnector } from '../src/connectors/git-connector.js';
import { WebConnector } from '../src/connectors/web-connector.js';
import { ApiConnector, redactSecrets } from '../src/connectors/api-connector.js';
import { config } from '../src/config/env.js';

describe('Day 8: Durable Background Ingestion, Synchronization, and Connectors', () => {
  const app = createApp();

  const userAEmail = `day8-user-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `day8-user-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'TestPassword123!';

  let userAToken: string;
  let userBToken: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let spaceAId: string;
  let spaceBId: string;
  let assistantAId: string;
  let sourceAId: string;

  beforeAll(async () => {
    // Clean up any stale queued/processing test jobs from previous runs
    await pool.query('DELETE FROM ingestion_jobs');

    // 1. Register User A (Workspace A)
    const regARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password,
        fullName: 'Day 8 Architect A',
        organizationName: 'Alpha Cloud Systems',
      });
    userAToken = regARes.body.token;
    workspaceAId = regARes.body.workspace.id;

    // 2. Register User B (Workspace B)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password,
        fullName: 'Day 8 Intruder B',
        organizationName: 'Beta External Systems',
      });
    userBToken = regBRes.body.token;
    workspaceBId = regBRes.body.workspace.id;

    // 3. Create Knowledge Spaces
    const spaceARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha Ops Guides',
        slug: `alpha-ops-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Operational runbooks and sync targets',
      });
    spaceAId = spaceARes.body.knowledgeSpace.id;

    const spaceBRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceBId}/knowledge-spaces`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Beta Specs',
        slug: `beta-specs-${crypto.randomUUID().slice(0, 6)}`,
        description: 'Isolated workspace specs',
      });
    spaceBId = spaceBRes.body.knowledgeSpace.id;

    // 4. Create Assistant
    const asstARes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/assistants`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Alpha Copilot',
        assistantKey: `alpha-asst-${crypto.randomUUID().slice(0, 6)}`,
        systemPrompt: 'Alpha operations assistant.',
      });
    assistantAId = asstARes.body.assistant.id;

    // 5. Create Document Source in Workspace A
    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceAId}/knowledge-spaces/${spaceAId}/sources`)
      .set('Authorization', `Bearer ${userAToken}`)
      .field('title', 'Cluster Maintenance SOP')
      .attach('file', Buffer.from('# Cluster Maintenance\n\nWeekly reboot cadence.', 'utf-8'), 'cluster.md');
    sourceAId = uploadRes.body.source.id;
  });

  afterAll(async () => {
    if (workspaceAId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceAId]);
    }
    if (workspaceBId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceBId]);
    }
  });

  describe('1. Durable Job Lifecycle & State Machine', () => {
    let testJobId: string;

    it('creates an ingestion job in queued status with lease and timeout metadata', async () => {
      const { job, isDuplicate } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
        jobType: 'document_ingest',
        payload: { filename: 'test.md' },
        maxAttempts: 3,
        timeoutSeconds: 120,
        leaseDurationSeconds: 45,
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('queued');
      expect(job.attempts).toBe(0);
      expect(job.timeoutSeconds).toBe(120);
      expect(job.leaseDurationSeconds).toBe(45);
      expect(isDuplicate).toBe(false);

      testJobId = job.id;
    });

    it('claims the eligible job atomically with worker lock and lease expiration', async () => {
      const claimed = await claimNextJob('worker-alpha-01', 30);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(testJobId);
      expect(claimed!.status).toBe('processing');
      expect(claimed!.lockedBy).toBe('worker-alpha-01');
      expect(claimed!.attempts).toBe(1);
      expect(claimed!.startedAt).not.toBeNull();
      expect(claimed!.leaseExpiresAt).not.toBeNull();
    });

    it('completes the claimed job cleanly and records execution output', async () => {
      const completed = await completeJob(testJobId, 'worker-alpha-01', {
        versionId: 'v1',
        chunkCount: 4,
      });

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).not.toBeNull();
      expect(completed.lockedBy).toBeNull();
      expect(completed.result.chunkCount).toBe(4);
    });

    it('rejects invalid state transition on completed job', async () => {
      await expect(completeJob(testJobId, 'worker-alpha-01')).rejects.toThrow();
    });
  });

  describe('2. Retry, Exponential Backoff & Failure Diagnostics', () => {
    it('schedules exponential backoff retry for transient errors', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
        jobType: 'source_sync',
        maxAttempts: 3,
      });

      // Claim job
      const claimed = await claimNextJob('worker-retry-01', 30);
      expect(claimed!.id).toBe(job.id);

      // Record transient error
      const retried = await failOrRetryJob(job.id, 'worker-retry-01', {
        errorCode: 'TRANSIENT_NETWORK',
        diagnosticMessage: 'Upstream gateway timed out (504)',
        isTransient: true,
      });

      expect(retried.status).toBe('retry_waiting');
      expect(retried.lockedBy).toBeNull();
      expect(retried.errorCode).toBe('TRANSIENT_NETWORK');
      expect(retried.diagnosticMessage).toContain('Upstream gateway');
      expect(new Date(retried.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('transitions directly to failed on permanent error without retrying', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
        jobType: 'document_ingest',
        maxAttempts: 3,
      });

      const claimed = await claimNextJob('worker-perm-01', 30);
      expect(claimed!.id).toBe(job.id);

      const failed = await failOrRetryJob(job.id, 'worker-perm-01', {
        errorCode: 'UNSUPPORTED_MEDIA',
        diagnosticMessage: 'Binary file is corrupted or unsupported',
        isTransient: false,
      });

      expect(failed.status).toBe('failed');
      expect(failed.completedAt).not.toBeNull();
      expect(failed.errorCode).toBe('UNSUPPORTED_MEDIA');
    });

    it('transitions to permanent failure when max retry attempts are exhausted', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
        maxAttempts: 1, // Only 1 attempt allowed
      });

      const claimed = await claimNextJob('worker-exhaust-01', 30);
      expect(claimed!.attempts).toBe(1);

      // Even if transient, maxAttempts (1) is exhausted
      const exhausted = await failOrRetryJob(job.id, 'worker-exhaust-01', {
        errorCode: 'TRANSIENT_SOCKET_RESET',
        diagnosticMessage: 'Connection reset by peer',
        isTransient: true,
      });

      expect(exhausted.status).toBe('failed');
      expect(exhausted.errorCode).toBe('TRANSIENT_SOCKET_RESET');
    });
  });

  describe('3. Idempotency & Stale Lease Recovery', () => {
    it('returns existing active job without creating duplicate when using idempotencyKey', async () => {
      const idempotencyKey = `sync-key-${crypto.randomUUID()}`;

      const res1 = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
        idempotencyKey,
      });
      expect(res1.isDuplicate).toBe(false);

      const res2 = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
        idempotencyKey,
      });
      expect(res2.isDuplicate).toBe(true);
      expect(res2.job.id).toBe(res1.job.id);
    });

    it('allows a secondary worker to claim a job whose lease has expired', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
      });

      // Claim job with very short lease (1 second) targeting this specific job
      const claimed = await claimNextJob('worker-crashed-01', 1, job.id);
      expect(claimed!.id).toBe(job.id);

      // Artificially expire the lease in the past
      await pool.query(
        `UPDATE ingestion_jobs SET lease_expires_at = NOW() - INTERVAL '5 seconds' WHERE id = $1;`,
        [job.id]
      );

      // Secondary worker recovers and claims the stale job
      const recovered = await claimNextJob('worker-recovery-02', 30, job.id);
      expect(recovered).not.toBeNull();
      expect(recovered!.id).toBe(job.id);
      expect(recovered!.lockedBy).toBe('worker-recovery-02');
      expect(recovered!.attempts).toBe(2);
    });
  });

  describe('4. Synchronization & Job Management REST API', () => {
    let apiJobId: string;

    it('POST /api/v1/knowledge-sources/:sourceId/sync enqueues synchronization job', async () => {
      const syncRes = await request(app)
        .post(`/api/v1/knowledge-sources/${sourceAId}/sync`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ idempotencyKey: `sync-${crypto.randomUUID().slice(0, 8)}` });

      expect(syncRes.status).toBe(202);
      expect(syncRes.body.status).toBe('queued');
      expect(syncRes.body.job.id).toBeDefined();

      apiJobId = syncRes.body.job.id;
    });

    it('GET /api/v1/ingestion-jobs/:jobId retrieves job details', async () => {
      const getRes = await request(app)
        .get(`/api/v1/ingestion-jobs/${apiJobId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('x-workspace-id', workspaceAId);

      expect(getRes.status).toBe(200);
      expect(getRes.body.job.id).toBe(apiJobId);
      expect(getRes.body.job.workspaceId).toBe(workspaceAId);
    });

    it('GET /api/v1/ingestion-jobs lists jobs within authorized workspace', async () => {
      const listRes = await request(app)
        .get(`/api/v1/ingestion-jobs?limit=10`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('x-workspace-id', workspaceAId);

      expect(listRes.status).toBe(200);
      expect(listRes.body.jobs).toBeInstanceOf(Array);
      expect(listRes.body.jobs.length).toBeGreaterThan(0);
      expect(listRes.body.jobs.every((j: any) => j.workspaceId === workspaceAId)).toBe(true);
    });

    it('POST /api/v1/ingestion-jobs/:jobId/cancel cancels a pending job', async () => {
      const cancelRes = await request(app)
        .post(`/api/v1/ingestion-jobs/${apiJobId}/cancel`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('x-workspace-id', workspaceAId);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.job.status).toBe('cancelled');
    });

    it('POST /api/v1/ingestion-jobs/:jobId/retry re-queues cancelled job', async () => {
      const retryRes = await request(app)
        .post(`/api/v1/ingestion-jobs/${apiJobId}/retry`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('x-workspace-id', workspaceAId);

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.job.status).toBe('queued');
      expect(retryRes.body.job.attempts).toBe(0);
    });
  });

  describe('5. SSRF Protections & Source Connectors', () => {
    it('blocks loopback and AWS/GCP cloud metadata IP addresses', async () => {
      // Loopback
      await expect(validateSafeUrl('http://127.0.0.1:8080/admin')).rejects.toThrow(SSRFViolationError);
      await expect(validateSafeUrl('http://localhost:3000/keys')).rejects.toThrow(SSRFViolationError);

      // Cloud Metadata (169.254.169.254)
      await expect(validateSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(SSRFViolationError);

      // Private RFC1918
      await expect(validateSafeUrl('http://10.0.0.1/internal')).rejects.toThrow(SSRFViolationError);
      await expect(validateSafeUrl('http://192.168.1.1/router')).rejects.toThrow(SSRFViolationError);
    });

    it('blocks non-HTTP schemes (file://, gopher://)', async () => {
      await expect(validateSafeUrl('file:///etc/passwd')).rejects.toThrow(SSRFViolationError);
      await expect(validateSafeUrl('gopher://target.com/')).rejects.toThrow(SSRFViolationError);
    });

    it('Git Connector validates repository URL and handles commit change detection', async () => {
      const git = new GitConnector();
      await expect(git.validateConfig({ repositoryUrl: 'http://127.0.0.1/bad' })).rejects.toThrow();

      const syncResult = await git.sync(
        { repositoryUrl: 'https://github.com/nomaanos/docs.git', branch: 'main' },
        { workspaceId: workspaceAId, knowledgeSpaceId: spaceAId, sourceId: sourceAId, jobId: 'job-1' }
      );

      expect(syncResult.success).toBe(true);
      expect(syncResult.connectorType).toBe('git');
      expect(syncResult.items.length).toBeGreaterThan(0);
      expect(syncResult.cursorOrCommitSha).toBeDefined();

      // Subsequent sync with identical commit SHA detects unchanged state
      const repeatSync = await git.sync(
        {
          repositoryUrl: 'https://github.com/nomaanos/docs.git',
          branch: 'main',
          lastCommitSha: syncResult.cursorOrCommitSha,
        },
        { workspaceId: workspaceAId, knowledgeSpaceId: spaceAId, sourceId: sourceAId, jobId: 'job-2' }
      );
      expect(repeatSync.itemsUnchanged).toBe(1);
      expect(repeatSync.items.length).toBe(0);
    });

    it('Web Connector enforces approved domain boundaries', async () => {
      const web = new WebConnector();

      // Disallowed domain
      await expect(
        web.validateConfig({
          baseUrl: 'https://malicious.evil.com/docs',
          allowedDomains: ['docs.nomaanos.io'],
        })
      ).rejects.toThrow(SSRFViolationError);

      // Allowed domain (using standard RFC2606 domain that resolves globally)
      const valid = await web.validateConfig({
        baseUrl: 'https://example.com/reference',
        allowedDomains: ['example.com'],
      });
      expect(valid.valid).toBe(true);
    });

    it('API Connector redacts sensitive headers in logs and metadata', () => {
      const headers = {
        Authorization: 'Bearer secret_super_token_12345',
        'X-API-Key': 'prod_api_key_abcdef',
        'Content-Type': 'application/json',
      };

      const sanitized = redactSecrets(headers);
      expect(sanitized.Authorization).toBe('[REDACTED]');
      expect(sanitized['X-API-Key']).toBe('[REDACTED]');
      expect(sanitized['Content-Type']).toBe('application/json');
    });
  });

  describe('6. Internal Worker Commit & Day 7 Chunking Bridge', () => {
    it('rejects internal worker commit without proper authentication key', async () => {
      const unauthRes = await request(app)
        .post('/api/v1/internal/ingestion/commit')
        .send({ jobId: 'job-123' });

      expect(unauthRes.status).toBe(401);
    });

    it('authenticates worker and executes Day 7 chunker and version supersession', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
      });

      const commitRes = await request(app)
        .post('/api/v1/internal/ingestion/commit')
        .set('x-internal-key', config.worker.internalApiKey)
        .send({
          jobId: job.id,
          workerId: 'worker-python-01',
          sourceId: sourceAId,
          workspaceId: workspaceAId,
          knowledgeSpaceId: spaceAId,
          title: 'Cluster Maintenance (Async Updated)',
          extractedData: {
            blocks: [
              { block_type: 'heading', level: 1, content: 'Cluster Maintenance Guide' },
              { block_type: 'paragraph', content: 'Asynchronously extracted by Python worker.' },
            ],
          },
          normalizedText: '# Cluster Maintenance Guide\n\nAsynchronously extracted by Python worker.',
          sha256: crypto.createHash('sha256').update('new async content').digest('hex'),
        });

      expect(commitRes.status).toBe(200);
      expect(commitRes.body.success).toBe(true);
      expect(commitRes.body.versionId).toBeDefined();
      expect(commitRes.body.chunkCount).toBeGreaterThanOrEqual(1);

      // Verify job status updated to completed in database
      const jobCheck = await pool.query('SELECT status, completed_at FROM ingestion_jobs WHERE id = $1;', [job.id]);
      expect(jobCheck.rows[0].status).toBe('completed');
      expect(jobCheck.rows[0].completed_at).not.toBeNull();
    });
  });

  describe('7. Strict Multi-Tenant Isolation', () => {
    it('rejects User B (Workspace B) from viewing or accessing User A jobs', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
      });

      // User B query for User A's job
      const crossJobRes = await request(app)
        .get(`/api/v1/ingestion-jobs/${job.id}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .set('x-workspace-id', workspaceBId);

      expect(crossJobRes.status).toBe(404);
    });

    it('rejects User B (Workspace B) from cancelling User A jobs', async () => {
      const { job } = await createIngestionJob({
        workspaceId: workspaceAId,
        knowledgeSpaceId: spaceAId,
        sourceId: sourceAId,
      });

      const crossCancelRes = await request(app)
        .post(`/api/v1/ingestion-jobs/${job.id}/cancel`)
        .set('Authorization', `Bearer ${userBToken}`)
        .set('x-workspace-id', workspaceBId);

      expect(crossCancelRes.status).toBe(404);
    });

    it('rejects User B (Workspace B) from synchronizing User A sources', async () => {
      const crossSyncRes = await request(app)
        .post(`/api/v1/knowledge-sources/${sourceAId}/sync`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(crossSyncRes.status).toBe(404);
    });
  });
});
