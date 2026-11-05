import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { recordAuditEvent } from './audit-service.js';
import { generateChunks, ChunkRecord } from './chunker.js';
import { persistChunkEmbeddings, ChunkToEmbed } from './embedding-service.js';

const execFileAsync = promisify(execFile);

export interface ProcessedDocumentResult {
  sourceId: string;
  workspaceId: string;
  knowledgeSpaceId: string;
  assistantId?: string | null;
  filename: string;
  title: string;
  fileSizeBytes: number;
  sha256: string;
  mimeType: string;
  status: 'uploaded' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed';
  extractedText: string;
  extractedData: Record<string, any>;
  warnings: Array<{ code: string; message: string; location?: string; severity?: string }>;
  errorMessage: string | null;
  storagePath: string;
  versionId: string;
  versionNumber: number;
  chunkCount: number;
  totalTokens: number;
  isDuplicate?: boolean;
  duplicateOfSourceId?: string;
  createdAt: string;
  updatedAt: string;
}

export class DocumentProcessingError extends Error {
  statusCode: number;
  details?: any;

  constructor(message: string, statusCode = 400, details?: any) {
    super(message);
    this.name = 'DocumentProcessingError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Sanitizes an untrusted filename, stripping directory traversal and null bytes.
 */
export function sanitizeFilename(rawFilename: string): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return 'document.txt';
  }
  let clean = rawFilename.replace(/\0/g, '').replace(/[\x00-\x1f\x7f]/g, '');
  clean = path.basename(clean);
  clean = clean.replace(/[<>:"/\\|?*]/g, '_').trim();
  if (!clean || clean === '.' || clean === '..') {
    return 'document.txt';
  }
  return clean.slice(0, 200);
}

/**
 * Validates file buffer, size, extension, and content signatures.
 */
export function validateUploadFile(
  fileBuffer: Buffer,
  originalFilename: string,
  declaredMimeType?: string
): { cleanFilename: string; ext: string; detectedMime: string } {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new DocumentProcessingError('Uploaded file is completely empty (0 bytes).', 400);
  }

  const maxBytes = config.upload.maxFileBytes;
  if (fileBuffer.length > maxBytes) {
    throw new DocumentProcessingError(
      `File size (${fileBuffer.length} bytes) exceeds maximum permitted limit of ${maxBytes} bytes (${(
        maxBytes /
        (1024 * 1024)
      ).toFixed(1)} MiB).`,
      413
    );
  }

  const cleanFilename = sanitizeFilename(originalFilename);
  const ext = path.extname(cleanFilename).toLowerCase();

  const allowedExts = config.upload.allowedExtensions;
  if (!allowedExts.includes(ext)) {
    throw new DocumentProcessingError(
      `Unsupported file extension '${ext}'. Allowed extensions: ${allowedExts.join(', ')}`,
      415
    );
  }

  let detectedMime = declaredMimeType || 'application/octet-stream';

  if (ext === '.pdf') {
    const signature = fileBuffer.slice(0, 5).toString('ascii');
    if (!signature.startsWith('%PDF-')) {
      throw new DocumentProcessingError(
        "MIME/content mismatch: File has .pdf extension but lacks the valid '%PDF-' header signature.",
        400
      );
    }
    detectedMime = 'application/pdf';
  } else if (ext === '.json') {
    detectedMime = 'application/json';
  } else if (ext === '.html' || ext === '.htm') {
    detectedMime = 'text/html';
  } else if (ext === '.md') {
    detectedMime = 'text/markdown';
  } else if (ext === '.txt') {
    detectedMime = 'text/plain';
  } else if (ext === '.yaml' || ext === '.yml') {
    detectedMime = 'application/x-yaml';
  }

  return { cleanFilename, ext, detectedMime };
}

/**
 * Finds the project root and returns the python executable and parser CLI path.
 */
function resolveParserPaths(): { pythonCmd: string; parserScript: string; parserSrcDir: string } {
  const root = path.resolve(process.cwd());
  const possiblePaths = [
    path.resolve(root, 'services/parser/src/nexus_parser/cli.py'),
    path.resolve(root, '../services/parser/src/nexus_parser/cli.py'),
    path.resolve(root, '../../services/parser/src/nexus_parser/cli.py'),
  ];

  const parserScript = possiblePaths.find((p) => fs.existsSync(p));
  if (!parserScript) {
    throw new Error(`nexus-parser CLI script not found. Checked: ${possiblePaths.join(', ')}`);
  }

  const parserSrcDir = path.resolve(path.dirname(parserScript), '..');
  const pythonCmd = process.env.PYTHON_PATH || 'python';

  return { pythonCmd, parserScript, parserSrcDir };
}

/**
 * Invokes the Python parser via subprocess and captures structured extraction JSON.
 */
export async function executeParser(
  filePath: string,
  cleanFilename: string,
  mimeType: string
): Promise<{
  title: string;
  normalizedText: string;
  status: 'completed' | 'completed_with_warnings' | 'failed';
  warnings: any[];
  errorMessage: string | null;
  extractedData: Record<string, any>;
}> {
  try {
    const { pythonCmd, parserScript, parserSrcDir } = resolveParserPaths();

    const env = {
      ...process.env,
      PYTHONPATH: parserSrcDir + (process.platform === 'win32' ? ';' : ':') + (process.env.PYTHONPATH || ''),
      PYTHONIOENCODING: 'utf-8',
    };

    const { stdout, stderr } = await execFileAsync(
      pythonCmd,
      [parserScript, filePath, '--mime-type', mimeType],
      {
        env,
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024,
      }
    );

    if (stderr && stderr.trim().length > 0) {
      logger.warn({ stderr: stderr.slice(0, 500), file: cleanFilename }, 'Parser emitted warning to stderr');
    }

    const parsed = JSON.parse(stdout);

    return {
      title: parsed.title || path.basename(cleanFilename, path.extname(cleanFilename)),
      normalizedText: parsed.normalized_text || '',
      status: parsed.status || (parsed.warnings?.length > 0 ? 'completed_with_warnings' : 'completed'),
      warnings: parsed.warnings || [],
      errorMessage: parsed.error_message || null,
      extractedData: {
        schema_version: parsed.schema_version,
        format: parsed.format,
        blocks: parsed.blocks || [],
        headings: parsed.headings || [],
        tables: parsed.tables || [],
        code_blocks: parsed.code_blocks || [],
        page_references: parsed.page_references || [],
        metadata: parsed.metadata || {},
      },
    };
  } catch (err: any) {
    if (err && err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        if (parsed && (parsed.status === 'failed' || parsed.error_message)) {
          return {
            title: parsed.title || path.basename(cleanFilename, path.extname(cleanFilename)),
            normalizedText: parsed.normalized_text || '',
            status: 'failed',
            warnings: parsed.warnings || [],
            errorMessage: parsed.error_message || 'Document extraction failed',
            extractedData: {
              schema_version: parsed.schema_version,
              format: parsed.format,
              blocks: parsed.blocks || [],
            },
          };
        }
      } catch {}
    }

    logger.error({ err, file: cleanFilename }, 'Subprocess parser execution failed; checking fallback');

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const isJson = filePath.endsWith('.json');
      const title = path.basename(cleanFilename, path.extname(cleanFilename));

      if (isJson) {
        try {
          JSON.parse(content);
        } catch (jsonErr: any) {
          return {
            title,
            normalizedText: '',
            status: 'failed',
            warnings: [],
            errorMessage: `Malformed JSON: ${jsonErr.message}`,
            extractedData: {},
          };
        }
      }

      return {
        title,
        normalizedText: content.slice(0, 100000),
        status: 'completed_with_warnings',
        warnings: [
          {
            code: 'FALLBACK_EXTRACTION_USED',
            message: 'Primary Python parser was unavailable; extracted using core TypeScript fallback extractor.',
            severity: 'info',
          },
        ],
        errorMessage: null,
        extractedData: {
          blocks: [{ block_type: isJson ? 'json' : 'paragraph', content: content.slice(0, 50000) }],
          fallback: true,
        },
      };
    } catch (fallbackErr: any) {
      return {
        title: cleanFilename,
        normalizedText: '',
        status: 'failed',
        warnings: [],
        errorMessage: `Parser extraction failure: ${err.message || 'Unknown parser error'}`,
        extractedData: {},
      };
    }
  }
}

/**
 * Persists chunks into document_chunks in batch within a transaction.
 * Returns the list of inserted chunks for vector embedding generation.
 */
async function persistChunks(
  client: any,
  workspaceId: string,
  knowledgeSpaceId: string,
  sourceId: string,
  versionId: string,
  chunks: ChunkRecord[]
): Promise<ChunkToEmbed[]> {
  if (chunks.length === 0) return [];
  const inserted: ChunkToEmbed[] = [];

  for (const chunk of chunks) {
    const res = await client.query(
      `INSERT INTO document_chunks (
         workspace_id, knowledge_space_id, source_id, version_id,
         chunk_index, content, token_count, chunk_hash, section_path,
         page_number, source_offset, is_active, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, content;`,
      [
        workspaceId,
        knowledgeSpaceId,
        sourceId,
        versionId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenCount,
        chunk.chunkHash,
        chunk.sectionPath,
        chunk.pageNumber,
        chunk.sourceOffset,
        true, // is_active
        JSON.stringify(chunk.metadata || {}),
      ]
    );

    if (res.rows[0]) {
      inserted.push({
        chunkId: res.rows[0].id,
        workspaceId,
        knowledgeSpaceId,
        content: res.rows[0].content,
      });
    }
  }

  return inserted;
}

/**
 * End-to-end initial document upload & registration pipeline with chunking and versioning.
 */
export async function processDocumentUpload(params: {
  workspaceId: string;
  knowledgeSpaceId: string;
  assistantId?: string | null;
  actorId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  declaredMimeType?: string;
  titleOverride?: string;
  customMetadata?: Record<string, any>;
}): Promise<ProcessedDocumentResult> {
  const {
    workspaceId,
    knowledgeSpaceId,
    assistantId,
    actorId,
    fileBuffer,
    originalFilename,
    declaredMimeType,
    titleOverride,
    customMetadata,
  } = params;

  // 1. Validation
  const { cleanFilename, ext, detectedMime } = validateUploadFile(
    fileBuffer,
    originalFilename,
    declaredMimeType
  );

  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const fileSizeBytes = fileBuffer.length;

  // 2. Private Storage Allocation (outside public web roots)
  const sourceId = crypto.randomUUID();
  const storageBaseDir = path.resolve(process.cwd(), config.storage.baseDir || 'storage');
  const targetDir = path.join(storageBaseDir, 'documents', workspaceId, sourceId);

  fs.mkdirSync(targetDir, { recursive: true });

  const storedFilename = `${crypto.randomUUID()}_${cleanFilename}`;
  const absoluteStoragePath = path.join(targetDir, storedFilename);

  fs.writeFileSync(absoluteStoragePath, fileBuffer);

  // 3. Deduplication Check (scoped strictly to caller's workspace & knowledge space)
  const existingSourceRes = await pool.query(
    `SELECT id, title, filename, status, current_version_id
     FROM document_sources 
     WHERE workspace_id = $1 AND knowledge_space_id = $2 AND sha256 = $3
     LIMIT 1;`,
    [workspaceId, knowledgeSpaceId, sha256]
  );

  const isDuplicate = existingSourceRes.rows.length > 0;
  const duplicateMetadata = isDuplicate
    ? { is_duplicate: true, duplicate_of_source_id: existingSourceRes.rows[0].id }
    : {};

  // 4. Initial Database Record (status: 'uploaded')
  const initialTitle = titleOverride?.trim() || path.basename(cleanFilename, ext);
  const combinedMetadata = {
    ...(customMetadata || {}),
    ...duplicateMetadata,
    original_filename: originalFilename,
    clean_filename: cleanFilename,
    extension: ext,
  };

  const insertSourceQuery = `
    INSERT INTO document_sources (
      id, workspace_id, knowledge_space_id, assistant_id, title, filename,
      mime_type, file_size_bytes, storage_path, sha256, status, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'uploaded', $11)
    RETURNING id, created_at, updated_at;
  `;

  const insertSourceRes = await pool.query(insertSourceQuery, [
    sourceId,
    workspaceId,
    knowledgeSpaceId,
    assistantId || null,
    initialTitle,
    cleanFilename,
    detectedMime,
    fileSizeBytes,
    absoluteStoragePath,
    sha256,
    JSON.stringify(combinedMetadata),
  ]);

  // 5. Execute Parser
  const parseResult = await executeParser(absoluteStoragePath, cleanFilename, detectedMime);

  const finalTitle = titleOverride?.trim() || parseResult.title || initialTitle;
  const finalStatus = parseResult.status;

  // 6. Structure-Aware Chunking
  let chunks: ChunkRecord[] = [];
  let totalTokens = 0;

  if (finalStatus !== 'failed') {
    chunks = generateChunks(parseResult.extractedData, parseResult.normalizedText, finalTitle);
    totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);
  }

  // 7. Transactional Version & Chunks Persistence
  const client = await pool.connect();
  let versionId = crypto.randomUUID();

  try {
    await client.query('BEGIN');

    // Insert Document Version 1
    const verRes = await client.query(
      `INSERT INTO document_versions (
         id, source_id, version_number, sha256, metadata, extracted_data,
         raw_content, status, is_current, chunk_count, total_tokens
       ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id;`,
      [
        versionId,
        sourceId,
        sha256,
        JSON.stringify(combinedMetadata),
        JSON.stringify(parseResult.extractedData),
        parseResult.normalizedText ? parseResult.normalizedText.slice(0, 100000) : null,
        finalStatus === 'failed' ? 'failed' : 'active',
        finalStatus !== 'failed', // is_current
        chunks.length,
        totalTokens,
      ]
    );
    versionId = verRes.rows[0].id;

    // Persist Chunks if extraction succeeded
    let insertedChunks: ChunkToEmbed[] = [];
    if (finalStatus !== 'failed' && chunks.length > 0) {
      insertedChunks = await persistChunks(client, workspaceId, knowledgeSpaceId, sourceId, versionId, chunks);
    }

    // Update Document Source
    await client.query(
      `UPDATE document_sources
       SET 
         title = $1,
         status = $2,
         current_version_id = $3,
         extracted_text = $4,
         extracted_data = $5,
         extraction_warnings = $6,
         error_message = $7,
         extracted_at = NOW(),
         updated_at = NOW()
       WHERE id = $8;`,
      [
        finalTitle,
        finalStatus,
        finalStatus !== 'failed' ? versionId : null,
        parseResult.normalizedText || '',
        JSON.stringify(parseResult.extractedData),
        JSON.stringify(parseResult.warnings),
        parseResult.errorMessage,
        sourceId,
      ]
    );

    await client.query('COMMIT');

    // Generate and persist local vector embeddings for active chunks
    if (insertedChunks.length > 0) {
      try {
        await persistChunkEmbeddings(insertedChunks);
      } catch (embErr) {
        logger.warn({ embErr, sourceId, versionId }, 'Deferred or failed chunk embedding generation during upload');
      }
    }
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  // 8. Record Security Audit Log
  await recordAuditEvent({
    workspaceId,
    actorId,
    action: 'document_source_registered',
    resourceType: 'document_source',
    resourceId: sourceId,
    details: {
      filename: cleanFilename,
      fileSizeBytes,
      status: finalStatus,
      warningsCount: parseResult.warnings.length,
      chunksCount: chunks.length,
      totalTokens,
      isDuplicate,
      assistantId,
    },
  });

  return {
    sourceId,
    workspaceId,
    knowledgeSpaceId,
    assistantId: assistantId || null,
    filename: cleanFilename,
    title: finalTitle,
    fileSizeBytes,
    sha256,
    mimeType: detectedMime,
    status: finalStatus,
    extractedText: parseResult.normalizedText,
    extractedData: parseResult.extractedData,
    warnings: parseResult.warnings,
    errorMessage: parseResult.errorMessage,
    storagePath: absoluteStoragePath,
    versionId,
    versionNumber: 1,
    chunkCount: chunks.length,
    totalTokens,
    isDuplicate,
    duplicateOfSourceId: isDuplicate ? existingSourceRes.rows[0].id : undefined,
    createdAt: insertSourceRes.rows[0].created_at,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Incremental Document Update Pipeline:
 * Creates a new version (v+1) with structure-aware chunks and transactionally supersedes
 * previous versions without corrupting active records on failure.
 */
export async function updateDocumentSource(params: {
  sourceId: string;
  workspaceId: string;
  actorId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  declaredMimeType?: string;
  titleOverride?: string;
  customMetadata?: Record<string, any>;
}): Promise<{
  sourceId: string;
  versionId: string;
  versionNumber: number;
  status: string;
  title: string;
  changed: boolean;
  unchanged?: boolean;
  chunkCount: number;
  totalTokens: number;
  supersededVersionId?: string | null;
  warnings: any[];
  errorMessage?: string | null;
}> {
  const {
    sourceId,
    workspaceId,
    actorId,
    fileBuffer,
    originalFilename,
    declaredMimeType,
    titleOverride,
    customMetadata,
  } = params;

  // 1. Fetch current source record and verify workspace isolation
  const sourceRes = await pool.query(
    `SELECT id, workspace_id, knowledge_space_id, assistant_id, title, filename, current_version_id
     FROM document_sources
     WHERE id = $1 AND workspace_id = $2;`,
    [sourceId, workspaceId]
  );

  if (sourceRes.rows.length === 0) {
    throw new DocumentProcessingError('Knowledge source not found in this workspace.', 404);
  }

  const currentSource = sourceRes.rows[0];
  const knowledgeSpaceId = currentSource.knowledge_space_id;
  const previousVersionId = currentSource.current_version_id;

  // 2. Validate new file
  const { cleanFilename, ext, detectedMime } = validateUploadFile(
    fileBuffer,
    originalFilename,
    declaredMimeType
  );

  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const fileSizeBytes = fileBuffer.length;

  // 3. Check if new file has identical hash to current version
  if (previousVersionId) {
    const curVerRes = await pool.query(
      `SELECT id, version_number, sha256, chunk_count, total_tokens
       FROM document_versions WHERE id = $1;`,
      [previousVersionId]
    );

    if (curVerRes.rows.length > 0 && curVerRes.rows[0].sha256 === sha256) {
      // Content unchanged: return current version
      return {
        sourceId,
        versionId: curVerRes.rows[0].id,
        versionNumber: curVerRes.rows[0].version_number,
        status: 'active',
        title: currentSource.title,
        changed: false,
        unchanged: true,
        chunkCount: curVerRes.rows[0].chunk_count,
        totalTokens: curVerRes.rows[0].total_tokens,
        supersededVersionId: null,
        warnings: [],
      };
    }
  }

  // 4. Save new binary file to private storage
  const storageBaseDir = path.resolve(process.cwd(), config.storage.baseDir || 'storage');
  const targetDir = path.join(storageBaseDir, 'documents', workspaceId, sourceId);
  fs.mkdirSync(targetDir, { recursive: true });

  const storedFilename = `${crypto.randomUUID()}_${cleanFilename}`;
  const absoluteStoragePath = path.join(targetDir, storedFilename);
  fs.writeFileSync(absoluteStoragePath, fileBuffer);

  // 5. Execute Parser on new content
  const parseResult = await executeParser(absoluteStoragePath, cleanFilename, detectedMime);
  const finalTitle = titleOverride?.trim() || parseResult.title || currentSource.title;
  const finalStatus = parseResult.status;

  if (finalStatus === 'failed') {
    throw new DocumentProcessingError(
      `Update rejected: Document extraction failed (${parseResult.errorMessage || 'Invalid format'}). Previous version remains active.`,
      400,
      { warnings: parseResult.warnings }
    );
  }

  // 6. Generate Structure-Aware Chunks
  const chunks = generateChunks(parseResult.extractedData, parseResult.normalizedText, finalTitle);
  const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);

  // 7. Transactional Version Supersession
  const client = await pool.connect();
  const newVersionId = crypto.randomUUID();
  let nextVersionNumber = 2;

  try {
    await client.query('BEGIN');

    // Determine next version number
    const maxVerRes = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver 
       FROM document_versions WHERE source_id = $1;`,
      [sourceId]
    );
    nextVersionNumber = maxVerRes.rows[0]?.next_ver || 2;

    // A. Insert new active version first (referencing previousVersionId as supersedes_version_id)
    await client.query(
      `INSERT INTO document_versions (
         id, source_id, version_number, sha256, metadata, extracted_data,
         raw_content, status, is_current, supersedes_version_id, chunk_count, total_tokens
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', TRUE, $8, $9, $10);`,
      [
        newVersionId,
        sourceId,
        nextVersionNumber,
        sha256,
        JSON.stringify(customMetadata || {}),
        JSON.stringify(parseResult.extractedData),
        parseResult.normalizedText ? parseResult.normalizedText.slice(0, 100000) : null,
        previousVersionId || null,
        chunks.length,
        totalTokens,
      ]
    );

    // B. Supersede previous active version(s)
    if (previousVersionId) {
      await client.query(
        `UPDATE document_versions 
         SET is_current = FALSE, status = 'superseded', superseded_by_version_id = $1
         WHERE id = $2;`,
        [newVersionId, previousVersionId]
      );

      // Deactivate chunks of previous version
      await client.query(
        `UPDATE document_chunks SET is_active = FALSE WHERE version_id = $1;`,
        [previousVersionId]
      );
      await client.query(
        `UPDATE chunk_embeddings SET is_active = FALSE WHERE chunk_id IN (SELECT id FROM document_chunks WHERE version_id = $1);`,
        [previousVersionId]
      );
    }

    // C. Persist new chunks with is_active = TRUE
    let newChunks: ChunkToEmbed[] = [];
    if (chunks.length > 0) {
      newChunks = await persistChunks(client, workspaceId, knowledgeSpaceId, sourceId, newVersionId, chunks);
    }

    // D. Update document source current pointer
    await client.query(
      `UPDATE document_sources
       SET 
         title = $1,
         filename = $2,
         mime_type = $3,
         file_size_bytes = $4,
         storage_path = $5,
         sha256 = $6,
         status = $7,
         current_version_id = $8,
         extracted_text = $9,
         extracted_data = $10,
         extraction_warnings = $11,
         error_message = NULL,
         extracted_at = NOW(),
         updated_at = NOW()
       WHERE id = $12;`,
      [
        finalTitle,
        cleanFilename,
        detectedMime,
        fileSizeBytes,
        absoluteStoragePath,
        sha256,
        finalStatus,
        newVersionId,
        parseResult.normalizedText || '',
        JSON.stringify(parseResult.extractedData),
        JSON.stringify(parseResult.warnings),
        sourceId,
      ]
    );

    await client.query('COMMIT');

    // Generate and persist local vector embeddings for active chunks
    if (newChunks.length > 0) {
      try {
        await persistChunkEmbeddings(newChunks);
      } catch (embErr) {
        logger.warn({ embErr, sourceId, newVersionId }, 'Deferred or failed chunk embedding generation during version creation');
      }
    }
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  // 8. Record Audit Log
  await recordAuditEvent({
    workspaceId,
    actorId,
    action: 'document_source_updated',
    resourceType: 'document_source',
    resourceId: sourceId,
    details: {
      versionNumber: nextVersionNumber,
      supersededVersionId: previousVersionId,
      chunksCount: chunks.length,
      totalTokens,
      sha256,
    },
  });

  return {
    sourceId,
    versionId: newVersionId,
    versionNumber: nextVersionNumber,
    status: 'active',
    title: finalTitle,
    changed: true,
    chunkCount: chunks.length,
    totalTokens,
    supersededVersionId: previousVersionId,
    warnings: parseResult.warnings,
  };
}
