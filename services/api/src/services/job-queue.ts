import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'retry_waiting';

export interface IngestionJobRecord {
  id: string;
  workspaceId: string;
  knowledgeSpaceId: string | null;
  sourceId: string | null;
  jobType: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  leaseExpiresAt: Date | null;
  timeoutSeconds: number;
  leaseDurationSeconds: number;
  errorCode: string | null;
  diagnosticMessage: string | null;
  lastError: string | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  payload: Record<string, any>;
  result: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

function mapRowToJob(row: any): IngestionJobRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    knowledgeSpaceId: row.knowledge_space_id,
    sourceId: row.source_id,
    jobType: row.job_type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    leaseExpiresAt: row.lease_expires_at,
    timeoutSeconds: row.timeout_seconds,
    leaseDurationSeconds: row.lease_duration_seconds,
    errorCode: row.error_code,
    diagnosticMessage: row.diagnostic_message,
    lastError: row.last_error,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload || {},
    result: row.result || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateJobParams {
  workspaceId: string;
  knowledgeSpaceId?: string | null;
  sourceId?: string | null;
  jobType?: string;
  payload?: Record<string, any>;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  maxAttempts?: number;
  timeoutSeconds?: number;
  leaseDurationSeconds?: number;
}

/**
 * Creates or retrieves an existing idempotent ingestion job.
 */
export async function createIngestionJob(params: CreateJobParams): Promise<{
  job: IngestionJobRecord;
  isDuplicate: boolean;
}> {
  const {
    workspaceId,
    knowledgeSpaceId = null,
    sourceId = null,
    jobType = 'document_ingest',
    payload = {},
    idempotencyKey = null,
    correlationId = null,
    maxAttempts = 3,
    timeoutSeconds = 300,
    leaseDurationSeconds = 60,
  } = params;

  // 1. Idempotency Check: Look for active job with same key in this workspace
  if (idempotencyKey) {
    const existingRes = await pool.query(
      `SELECT * FROM ingestion_jobs
       WHERE workspace_id = $1 
         AND idempotency_key = $2 
         AND status IN ('queued', 'processing', 'retry_waiting')
       LIMIT 1;`,
      [workspaceId, idempotencyKey]
    );

    if (existingRes.rows.length > 0) {
      logger.info(
        { jobId: existingRes.rows[0].id, idempotencyKey, workspaceId },
        'Idempotent ingestion job returned without duplicate creation'
      );
      return {
        job: mapRowToJob(existingRes.rows[0]),
        isDuplicate: true,
      };
    }
  }

  // 2. Insert new queued job
  const insertQuery = `
    INSERT INTO ingestion_jobs (
      workspace_id,
      knowledge_space_id,
      source_id,
      job_type,
      status,
      attempts,
      max_attempts,
      scheduled_at,
      timeout_seconds,
      lease_duration_seconds,
      correlation_id,
      idempotency_key,
      payload,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, 'queued', 0, $5, NOW(), $6, $7, $8, $9, $10, NOW(), NOW()
    )
    RETURNING *;
  `;

  const insertRes = await pool.query(insertQuery, [
    workspaceId,
    knowledgeSpaceId,
    sourceId,
    jobType,
    maxAttempts,
    timeoutSeconds,
    leaseDurationSeconds,
    correlationId,
    idempotencyKey,
    JSON.stringify(payload),
  ]);

  const createdJob = mapRowToJob(insertRes.rows[0]);
  logger.info({ jobId: createdJob.id, jobType, workspaceId }, 'Created durable ingestion job');
  return {
    job: createdJob,
    isDuplicate: false,
  };
}

/**
 * Concurrency-safe atomic job claiming using SELECT ... FOR UPDATE SKIP LOCKED.
 * Discovers queued jobs or expired processing leases.
 */
export async function claimNextJob(
  workerId: string,
  leaseDurationSeconds: number = 60,
  targetJobId?: string
): Promise<IngestionJobRecord | null> {
  const params: any[] = [workerId, leaseDurationSeconds];
  let targetFilter = '';
  if (targetJobId) {
    params.push(targetJobId);
    targetFilter = `AND id = $${params.length}`;
  }

  const claimQuery = `
    UPDATE ingestion_jobs
    SET
      status = 'processing',
      locked_by = $1,
      locked_at = NOW(),
      lease_expires_at = NOW() + ($2 || ' seconds')::interval,
      started_at = COALESCE(started_at, NOW()),
      attempts = attempts + 1,
      updated_at = NOW()
    WHERE id = (
      SELECT id FROM ingestion_jobs
      WHERE (
        (status IN ('queued', 'retry_waiting') AND scheduled_at <= NOW())
        OR
        (status = 'processing' AND lease_expires_at < NOW())
      )
      ${targetFilter}
      ORDER BY scheduled_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `;

  const claimRes = await pool.query(claimQuery, params);
  if (claimRes.rows.length === 0) {
    return null;
  }

  const job = mapRowToJob(claimRes.rows[0]);
  logger.info(
    { jobId: job.id, workerId, attempt: job.attempts, leaseExpires: job.leaseExpiresAt },
    'Job claimed successfully by worker'
  );
  return job;
}

/**
 * Worker heartbeat: renews the lease on an actively processing job.
 */
export async function heartbeatJob(
  jobId: string,
  workerId: string,
  leaseDurationSeconds: number = 60
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE ingestion_jobs
     SET lease_expires_at = NOW() + ($3 || ' seconds')::interval,
         updated_at = NOW()
     WHERE id = $1 AND locked_by = $2 AND status = 'processing'
     RETURNING id;`,
    [jobId, workerId, leaseDurationSeconds]
  );
  return res.rows.length > 0;
}

/**
 * Completes a job cleanly, recording output results and releasing worker lease.
 */
export async function completeJob(
  jobId: string,
  workerId: string,
  result: Record<string, any> = {}
): Promise<IngestionJobRecord> {
  const res = await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'completed',
         completed_at = NOW(),
         result = $2,
         locked_by = NULL,
         lease_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND status = 'processing'
     RETURNING *;`,
    [jobId, JSON.stringify(result)]
  );

  if (res.rows.length === 0) {
    throw new Error(`Cannot complete job ${jobId}: job is not in 'processing' status or does not exist.`);
  }

  logger.info({ jobId, workerId }, 'Job completed successfully');
  return mapRowToJob(res.rows[0]);
}

export interface FailJobOptions {
  errorCode: string;
  diagnosticMessage: string;
  isTransient?: boolean;
}

/**
 * Handles job failure with classification into transient (exponential backoff) or permanent failure.
 */
export async function failOrRetryJob(
  jobId: string,
  workerId: string,
  options: FailJobOptions
): Promise<IngestionJobRecord> {
  const { errorCode, diagnosticMessage, isTransient = false } = options;

  // Retrieve job to evaluate attempts against maxAttempts
  const curRes = await pool.query(`SELECT attempts, max_attempts FROM ingestion_jobs WHERE id = $1;`, [jobId]);
  if (curRes.rows.length === 0) {
    throw new Error(`Job ${jobId} not found.`);
  }

  const { attempts, max_attempts } = curRes.rows[0];
  const shouldRetry = isTransient && attempts < max_attempts;

  if (shouldRetry) {
    // Exponential backoff with jitter: delay = min(300, 2^attempt * 2 + jitter)
    const jitter = Math.random() * 2;
    const delaySeconds = Math.min(300, Math.max(2, Math.floor(Math.pow(2, attempts) * 2 + jitter)));

    const retryRes = await pool.query(
      `UPDATE ingestion_jobs
       SET status = 'retry_waiting',
           scheduled_at = NOW() + ($2 || ' seconds')::interval,
           locked_by = NULL,
           lease_expires_at = NULL,
           error_code = $3,
           diagnostic_message = $4,
           last_error = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *;`,
      [jobId, delaySeconds, errorCode, diagnosticMessage]
    );

    logger.warn(
      { jobId, attempt: attempts, maxAttempts: max_attempts, delaySeconds, errorCode },
      'Job scheduled for retry with exponential backoff'
    );
    return mapRowToJob(retryRes.rows[0]);
  } else {
    // Permanent failure (or retry limit exhausted)
    const failRes = await pool.query(
      `UPDATE ingestion_jobs
       SET status = 'failed',
           completed_at = NOW(),
           locked_by = NULL,
           lease_expires_at = NULL,
           error_code = $2,
           diagnostic_message = $3,
           last_error = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *;`,
      [jobId, errorCode, diagnosticMessage]
    );

    logger.error(
      { jobId, attempt: attempts, maxAttempts: max_attempts, errorCode, diagnosticMessage },
      'Job transitioned to permanent failure'
    );
    return mapRowToJob(failRes.rows[0]);
  }
}

/**
 * Manually retries a failed or cancelled job.
 */
export async function retryFailedJob(jobId: string, workspaceId: string): Promise<IngestionJobRecord> {
  const checkRes = await pool.query(
    `SELECT status FROM ingestion_jobs WHERE id = $1 AND workspace_id = $2;`,
    [jobId, workspaceId]
  );
  if (checkRes.rows.length === 0) {
    const error: any = new Error('Ingestion job not found.');
    error.statusCode = 404;
    error.name = 'NotFound';
    throw error;
  }

  const currentStatus = checkRes.rows[0].status;
  if (!['failed', 'cancelled'].includes(currentStatus)) {
    const error: any = new Error(`Job in status '${currentStatus}' is not eligible for retry.`);
    error.statusCode = 400;
    error.name = 'InvalidStateTransition';
    throw error;
  }

  const res = await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'queued',
         attempts = 0,
         scheduled_at = NOW(),
         completed_at = NULL,
         error_code = NULL,
         diagnostic_message = NULL,
         last_error = NULL,
         locked_by = NULL,
         lease_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *;`,
    [jobId, workspaceId]
  );

  logger.info({ jobId, workspaceId }, 'Job manually re-queued');
  return mapRowToJob(res.rows[0]);
}

/**
 * Cancels a pending or processing job safely.
 */
export async function cancelJob(jobId: string, workspaceId: string): Promise<IngestionJobRecord> {
  const checkRes = await pool.query(
    `SELECT status FROM ingestion_jobs WHERE id = $1 AND workspace_id = $2;`,
    [jobId, workspaceId]
  );
  if (checkRes.rows.length === 0) {
    const error: any = new Error('Ingestion job not found.');
    error.statusCode = 404;
    error.name = 'NotFound';
    throw error;
  }

  const currentStatus = checkRes.rows[0].status;
  if (!['queued', 'processing', 'retry_waiting'].includes(currentStatus)) {
    const error: any = new Error(`Job in status '${currentStatus}' cannot be cancelled.`);
    error.statusCode = 400;
    error.name = 'InvalidStateTransition';
    throw error;
  }

  const res = await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'cancelled',
         completed_at = NOW(),
         locked_by = NULL,
         lease_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *;`,
    [jobId, workspaceId]
  );

  logger.info({ jobId, workspaceId }, 'Job cancelled');
  return mapRowToJob(res.rows[0]);
}

/**
 * Retrieves a single job with workspace authorization.
 */
export async function getJobById(jobId: string, workspaceId: string): Promise<IngestionJobRecord | null> {
  const res = await pool.query(
    `SELECT * FROM ingestion_jobs WHERE id = $1 AND workspace_id = $2;`,
    [jobId, workspaceId]
  );
  if (res.rows.length === 0) return null;
  return mapRowToJob(res.rows[0]);
}

/**
 * Lists ingestion jobs in a workspace with optional status, source, and pagination filters.
 */
export async function listJobs(
  workspaceId: string,
  filter: {
    sourceId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ jobs: IngestionJobRecord[]; total: number }> {
  const { sourceId, status, limit = 20, offset = 0 } = filter;

  let query = `SELECT * FROM ingestion_jobs WHERE workspace_id = $1`;
  const params: any[] = [workspaceId];

  if (sourceId) {
    params.push(sourceId);
    query += ` AND source_id = $${params.length}`;
  }

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2};`;
  params.push(Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));

  let countQuery = `SELECT COUNT(*)::int AS count FROM ingestion_jobs WHERE workspace_id = $1`;
  const countParams: any[] = [workspaceId];
  if (sourceId) {
    countParams.push(sourceId);
    countQuery += ` AND source_id = $${countParams.length}`;
  }
  if (status) {
    countParams.push(status);
    countQuery += ` AND status = $${countParams.length}`;
  }

  const [rowsRes, countRes] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, countParams),
  ]);

  return {
    jobs: rowsRes.rows.map(mapRowToJob),
    total: countRes.rows[0]?.count || 0,
  };
}
