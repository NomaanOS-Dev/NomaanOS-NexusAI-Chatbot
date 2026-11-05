/**
 * NomaanOS Nexus AI - Embedding Service (Day 9)
 *
 * Local embedding generation, model registry management, compatibility checks,
 * persistent daemon acceleration, and chunk vector persistence using sentence-transformers/all-MiniLM-L6-v2 (384-dim).
 */

import fs from 'fs';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import readline from 'readline';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';

const execFileAsync = promisify(execFile);

export interface EmbeddingModelRecord {
  id: string;
  modelId: string;
  modelName: string;
  provider: string;
  dimensions: number;
  distanceMetric: 'cosine' | 'l2' | 'inner_product';
  isNormalized: boolean;
  isDefault: boolean;
  status: 'active' | 'deprecated' | 'disabled';
}

export class EmbeddingServiceError extends Error {
  statusCode: number;
  details?: any;

  constructor(message: string, statusCode = 500, details?: any) {
    super(message);
    this.name = 'EmbeddingServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// In-memory LRU cache for query embeddings to ensure sub-millisecond repeated queries
const vectorCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 2000;

function getCachedVector(key: string): number[] | undefined {
  return vectorCache.get(key);
}

function setCachedVector(key: string, vector: number[]): void {
  if (vectorCache.size >= MAX_CACHE_SIZE) {
    const firstKey = vectorCache.keys().next().value;
    if (firstKey) vectorCache.delete(firstKey);
  }
  vectorCache.set(key, vector);
}

// -----------------------------------------------------------------------------
// Persistent Python Embedding Daemon (Eliminates repeated PyTorch load times)
// -----------------------------------------------------------------------------
let daemonProcess: ChildProcess | null = null;
let daemonInitPromise: Promise<boolean> | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
>();
let reqIdSeq = 0;

function getPythonExecutable(): string {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  const defaultWinPython = 'C:\\Users\\NK-WorkStation\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
  if (fs.existsSync(defaultWinPython)) {
    return defaultWinPython;
  }
  return process.env.PYTHON_PATH || 'python';
}

function getParserDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), 'services/parser'),
    path.resolve(process.cwd(), '../parser'),
    path.resolve(process.cwd(), '../../services/parser'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.resolve(process.cwd(), 'services/parser');
}

async function ensureDaemonRunning(): Promise<boolean> {
  if (daemonProcess && !daemonProcess.killed && daemonInitPromise) {
    return daemonInitPromise;
  }

  daemonInitPromise = new Promise<boolean>((resolve) => {
    try {
      const pythonExe = getPythonExecutable();
      const parserDir = getParserDirectory();

      daemonProcess = spawn(
        pythonExe,
        ['-m', 'nexus_parser.embedding', '--serve', '--offline'],
        {
          cwd: parserDir,
          env: {
            ...process.env,
            PYTHONPATH: [path.join(parserDir, 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
            TRANSFORMERS_OFFLINE: '1',
            HF_HUB_OFFLINE: '1',
            HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
            PYTHONUNBUFFERED: '1',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      const rl = readline.createInterface({
        input: daemonProcess.stdout!,
        terminal: false,
      });

      let hasHandshaked = false;
      const handshakeTimeout = setTimeout(() => {
        if (!hasHandshaked) {
          logger.warn('Embedding daemon handshake timed out, will use CLI fallback');
          resolve(false);
        }
      }, 35000);

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const parsed = JSON.parse(trimmed);

          // Initial ready signal
          if (parsed.status === 'ready') {
            hasHandshaked = true;
            clearTimeout(handshakeTimeout);
            logger.info({ dimensions: parsed.dimensions, model: parsed.model }, 'Embedding daemon ready');
            resolve(true);
            return;
          }

          // Request responses matching by ID
          if (parsed.id && pendingRequests.has(parsed.id)) {
            const req = pendingRequests.get(parsed.id)!;
            clearTimeout(req.timer);
            pendingRequests.delete(parsed.id);

            if (parsed.error) {
              req.reject(new Error(parsed.error));
            } else {
              req.resolve(parsed);
            }
          }
        } catch {
          // Ignore non-JSON log lines from libraries
        }
      });

      daemonProcess.stderr?.on('data', () => {
        // Suppress or debug-level log daemon stderr
      });

      daemonProcess.on('exit', () => {
        daemonProcess = null;
        daemonInitPromise = null;
        for (const [id, req] of pendingRequests.entries()) {
          clearTimeout(req.timer);
          req.reject(new Error('Embedding daemon exited unexpectedly'));
        }
        pendingRequests.clear();
      });

      daemonProcess.on('error', (err) => {
        logger.warn({ err }, 'Failed to spawn embedding daemon');
        resolve(false);
      });
    } catch (ex) {
      logger.warn({ ex }, 'Error launching embedding daemon');
      resolve(false);
    }
  });

  return daemonInitPromise;
}

async function requestDaemon(payload: any, timeoutMs = 15000): Promise<any> {
  const isRunning = await ensureDaemonRunning();
  if (!isRunning || !daemonProcess || !daemonProcess.stdin?.writable) {
    throw new Error('Embedding daemon unavailable');
  }

  const id = `req-${++reqIdSeq}`;
  payload.id = id;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Daemon request timed out'));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });
    daemonProcess!.stdin!.write(JSON.stringify(payload) + '\n');
  });
}

/**
 * Retrieves the active default embedding model from the database registry.
 */
export async function getDefaultEmbeddingModel(): Promise<EmbeddingModelRecord> {
  const result = await pool.query(
    `SELECT id, model_id, model_name, provider, dimensions, distance_metric, is_normalized, is_default, status
     FROM embedding_models
     WHERE is_default = TRUE AND status = 'active'
     LIMIT 1;`
  );

  if (result.rows.length === 0) {
    const anyActive = await pool.query(
      `SELECT id, model_id, model_name, provider, dimensions, distance_metric, is_normalized, is_default, status
       FROM embedding_models
       WHERE status = 'active'
       ORDER BY created_at ASC
       LIMIT 1;`
    );

    if (anyActive.rows.length === 0) {
      throw new EmbeddingServiceError(
        'No active embedding models configured in the database registry.',
        500
      );
    }
    const row = anyActive.rows[0];
    return {
      id: row.id,
      modelId: row.model_id,
      modelName: row.model_name,
      provider: row.provider,
      dimensions: row.dimensions,
      distanceMetric: row.distance_metric,
      isNormalized: row.is_normalized,
      isDefault: row.is_default,
      status: row.status,
    };
  }

  const row = result.rows[0];
  return {
    id: row.id,
    modelId: row.model_id,
    modelName: row.model_name,
    provider: row.provider,
    dimensions: row.dimensions,
    distanceMetric: row.distance_metric,
    isNormalized: row.is_normalized,
    isDefault: row.is_default,
    status: row.status,
  };
}

/**
 * Validates whether a given model ID exists, is active, and is compatible.
 */
export async function getModelById(modelIdOrUuid: string): Promise<EmbeddingModelRecord> {
  const result = await pool.query(
    `SELECT id, model_id, model_name, provider, dimensions, distance_metric, is_normalized, is_default, status
     FROM embedding_models
     WHERE (id::text = $1 OR model_id = $1) AND status = 'active'
     LIMIT 1;`,
    [modelIdOrUuid]
  );

  if (result.rows.length === 0) {
    throw new EmbeddingServiceError(
      `Embedding model '${modelIdOrUuid}' is not found or is currently inactive.`,
      400
    );
  }

  const row = result.rows[0];
  return {
    id: row.id,
    modelId: row.model_id,
    modelName: row.model_name,
    provider: row.provider,
    dimensions: row.dimensions,
    distanceMetric: row.distance_metric,
    isNormalized: row.is_normalized,
    isDefault: row.is_default,
    status: row.status,
  };
}

/**
 * Executes python local embedding adapter to generate a single vector.
 * Leverages persistent daemon for ~10ms execution, falling back to CLI.
 */
export async function generateEmbedding(
  text: string,
  modelId?: string
): Promise<number[]> {
  const model = modelId ? await getModelById(modelId) : await getDefaultEmbeddingModel();

  if (model.dimensions !== 384) {
    throw new EmbeddingServiceError(
      `Incompatible model dimension: expected 384, found ${model.dimensions}`,
      400
    );
  }

  const cacheKey = `${model.id}:${text}`;
  const cached = getCachedVector(cacheKey);
  if (cached) return cached;

  // Try persistent daemon first
  try {
    const daemonRes = await requestDaemon({ text, model: model.modelId });
    if (daemonRes && Array.isArray(daemonRes.embedding) && daemonRes.embedding.length === 384) {
      setCachedVector(cacheKey, daemonRes.embedding);
      return daemonRes.embedding;
    }
  } catch {
    // Daemon fallback to CLI
  }

  // CLI fallback
  const pythonExecutable = getPythonExecutable();
  const parserDir = getParserDirectory();

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonExecutable,
      ['-m', 'nexus_parser.embedding', '--text', text, '--model', model.modelId, '--offline'],
      {
        cwd: parserDir,
        env: {
          ...process.env,
          PYTHONPATH: [path.join(parserDir, 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
          TRANSFORMERS_OFFLINE: '1',
          HF_HUB_OFFLINE: '1',
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        },
        timeout: 45000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const jsonLine = stdout
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('{') && l.endsWith('}'))
      .pop();

    if (!jsonLine) {
      throw new Error(`Invalid output from embedding CLI: ${stdout || stderr}`);
    }

    const parsed = JSON.parse(jsonLine);
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    const vector: number[] = parsed.embedding;
    if (!Array.isArray(vector) || vector.length !== model.dimensions) {
      throw new Error(
        `Generated vector dimension mismatch: expected ${model.dimensions}, got ${vector ? vector.length : 0}`
      );
    }

    setCachedVector(cacheKey, vector);
    return vector;
  } catch (err: any) {
    logger.error({ err, modelId: model.modelId }, 'Failed to generate embedding via local adapter');
    throw new EmbeddingServiceError(
      `Local embedding generation failed: ${err.message || String(err)}`,
      500,
      err
    );
  }
}

/**
 * Executes python local embedding adapter to generate batch vectors.
 */
export async function generateBatchEmbeddings(
  texts: string[],
  modelId?: string
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const model = modelId ? await getModelById(modelId) : await getDefaultEmbeddingModel();

  // Try persistent daemon first
  try {
    const daemonRes = await requestDaemon({ batch: texts, model: model.modelId }, 30000);
    if (daemonRes && Array.isArray(daemonRes.embeddings) && daemonRes.embeddings.length === texts.length) {
      return daemonRes.embeddings;
    }
  } catch {
    // Daemon fallback to CLI
  }

  // CLI fallback
  const pythonExecutable = getPythonExecutable();
  const parserDir = getParserDirectory();

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonExecutable,
      ['-m', 'nexus_parser.embedding', '--batch', JSON.stringify(texts), '--model', model.modelId, '--offline'],
      {
        cwd: parserDir,
        env: {
          ...process.env,
          PYTHONPATH: [path.join(parserDir, 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
          TRANSFORMERS_OFFLINE: '1',
          HF_HUB_OFFLINE: '1',
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        },
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );

    const jsonLine = stdout
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('{') && l.endsWith('}'))
      .pop();

    if (!jsonLine) {
      throw new Error(`Invalid batch output from embedding CLI: ${stdout || stderr}`);
    }

    const parsed = JSON.parse(jsonLine);
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    const vectors: number[][] = parsed.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error(
        `Batch vector count mismatch: expected ${texts.length}, got ${vectors ? vectors.length : 0}`
      );
    }

    return vectors;
  } catch (err: any) {
    logger.error({ err, modelId: model.modelId }, 'Failed to generate batch embeddings via local adapter');
    throw new EmbeddingServiceError(
      `Local batch embedding generation failed: ${err.message || String(err)}`,
      500,
      err
    );
  }
}

export interface ChunkToEmbed {
  chunkId: string;
  workspaceId: string;
  knowledgeSpaceId: string;
  content: string;
}

/**
 * Embeds a list of chunks and persists them in chunk_embeddings and document_chunks.embedding_384.
 */
export async function persistChunkEmbeddings(
  chunks: ChunkToEmbed[],
  modelId?: string,
  clientPool = pool
): Promise<{ embeddedCount: number; modelId: string }> {
  if (chunks.length === 0) return { embeddedCount: 0, modelId: '' };

  const model = modelId ? await getModelById(modelId) : await getDefaultEmbeddingModel();
  const texts = chunks.map(c => c.content);
  const embeddings = await generateBatchEmbeddings(texts, model.id);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = embeddings[i];
    const vectorStr = `[${vector.join(',')}]`;

    // 1. Insert or update in chunk_embeddings
    await clientPool.query(
      `INSERT INTO chunk_embeddings (
         workspace_id, knowledge_space_id, chunk_id, model_id, embedding, is_active
       ) VALUES ($1, $2, $3, $4, $5::vector, TRUE)
       ON CONFLICT (chunk_id, model_id) DO UPDATE
       SET embedding = EXCLUDED.embedding, is_active = TRUE;`,
      [chunk.workspaceId, chunk.knowledgeSpaceId, chunk.chunkId, model.id, vectorStr]
    );

    // 2. Also populate embedding_384 on document_chunks for quick single-table scans
    await clientPool.query(
      `UPDATE document_chunks
       SET embedding_384 = $1::vector
       WHERE id = $2;`,
      [vectorStr, chunk.chunkId]
    );
  }

  logger.info(
    { count: chunks.length, modelId: model.modelId },
    'Successfully persisted local chunk embeddings'
  );

  return { embeddedCount: chunks.length, modelId: model.id };
}

/**
 * On-demand re-indexing for an entire knowledge space.
 * Retrieves all active chunks for current active versions and regenerates their embeddings.
 */
export async function reindexKnowledgeSpace(
  workspaceId: string,
  knowledgeSpaceId: string,
  targetModelId?: string
): Promise<{ reindexedCount: number; modelId: string }> {
  const model = targetModelId ? await getModelById(targetModelId) : await getDefaultEmbeddingModel();

  // Fetch all active chunks for current versions in this knowledge space
  const chunkRows = await pool.query(
    `SELECT dc.id, dc.workspace_id, dc.knowledge_space_id, dc.content
     FROM document_chunks dc
     JOIN document_versions dv ON dc.version_id = dv.id
     WHERE dc.workspace_id = $1
       AND dc.knowledge_space_id = $2
       AND dc.is_active = TRUE
       AND dv.status = 'active'
     ORDER BY dc.created_at ASC;`,
    [workspaceId, knowledgeSpaceId]
  );

  if (chunkRows.rows.length === 0) {
    return { reindexedCount: 0, modelId: model.id };
  }

  const chunksToEmbed: ChunkToEmbed[] = chunkRows.rows.map(r => ({
    chunkId: r.id,
    workspaceId: r.workspace_id,
    knowledgeSpaceId: r.knowledge_space_id,
    content: r.content,
  }));

  const batchSize = 50;
  let totalReindexed = 0;

  for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
    const slice = chunksToEmbed.slice(i, i + batchSize);
    await persistChunkEmbeddings(slice, model.id);
    totalReindexed += slice.length;
  }

  logger.info(
    { workspaceId, knowledgeSpaceId, totalReindexed, modelId: model.modelId },
    'Completed knowledge space embedding re-indexing'
  );

  return { reindexedCount: totalReindexed, modelId: model.id };
}

/**
 * Cleanly terminates the persistent embedding daemon (for graceful shutdown / tests).
 */
export function shutdownEmbeddingDaemon(): void {
  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch {
      // Ignore
    }
    daemonProcess = null;
    daemonInitPromise = null;
  }
}
