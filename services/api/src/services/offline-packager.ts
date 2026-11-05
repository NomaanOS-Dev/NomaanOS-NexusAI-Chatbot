/**
 * NomaanOS Nexus AI - Offline Knowledge Packager & Transfer Service (Day 18)
 *
 * Implements the approved offline transfer mechanism for moving knowledge spaces,
 * document versions, metadata, and pre-computed embeddings across air-gapped security boundaries.
 * Includes cryptographic SHA-256 package checksum verification.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { pool as defaultPool } from '../database/pool.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import type {
  OfflineKnowledgePackage,
  OfflinePackageManifest,
  OfflinePackageDocument,
  KnowledgeImportResult,
  OfflineSystemStatus,
} from '@nomaanos/nexus-shared-types';

export class OfflinePackagerService {
  private readonly pool: Pool;

  constructor(customPool?: Pool) {
    this.pool = customPool || defaultPool;
  }

  /**
   * Exports an existing knowledge space and its associated documents, versions,
   * chunks, and embeddings into a portable offline package with a SHA-256 manifest checksum.
   */
  async exportKnowledgePackage(options: {
    workspaceId: string;
    knowledgeSpaceId: string;
    saveToDisk?: boolean;
  }): Promise<OfflineKnowledgePackage> {
    const { workspaceId, knowledgeSpaceId, saveToDisk = true } = options;

    // 1. Fetch knowledge space
    const ksRes = await this.pool.query(
      `SELECT id, name, slug, description FROM knowledge_spaces 
       WHERE id = $1 AND workspace_id = $2;`,
      [knowledgeSpaceId, workspaceId]
    );

    if (ksRes.rows.length === 0) {
      throw new Error(`Knowledge space '${knowledgeSpaceId}' not found in workspace '${workspaceId}'`);
    }
    const ks = ksRes.rows[0];

    // 2. Fetch all document sources & active versions
    const sourcesRes = await this.pool.query(
      `SELECT ds.id, ds.title, ds.filename, ds.mime_type, ds.file_size_bytes, ds.sha256, ds.metadata,
              COALESCE(dv.version_number, 1) AS version_number
       FROM document_sources ds
       LEFT JOIN document_versions dv ON ds.id = dv.source_id AND dv.is_current = TRUE
       WHERE ds.knowledge_space_id = $1 AND ds.workspace_id = $2 AND ds.status != 'archived'
       ORDER BY ds.created_at ASC;`,
      [knowledgeSpaceId, workspaceId]
    );

    const documents: OfflinePackageDocument[] = [];
    let totalChunkCount = 0;

    for (const src of sourcesRes.rows) {
      // 3. Fetch chunks for this document
      const chunksRes = await this.pool.query(
        `SELECT chunk_index, content, token_count, section_path, page_number, source_offset, metadata,
                embedding::text AS raw_embedding
         FROM document_chunks
         WHERE source_id = $1 AND workspace_id = $2
         ORDER BY chunk_index ASC;`,
        [src.id, workspaceId]
      );

      const chunks = chunksRes.rows.map((r: any) => {
        let embedding: number[] | null = null;
        if (r.raw_embedding) {
          try {
            // raw_embedding is format "[0.1,0.2,...]"
            embedding = JSON.parse(r.raw_embedding);
          } catch {
            embedding = null;
          }
        }
        return {
          chunkIndex: r.chunk_index,
          content: r.content,
          tokenCount: r.token_count,
          sectionPath: r.section_path,
          pageNumber: r.page_number,
          sourceOffset: r.source_offset,
          metadata: r.metadata || {},
          embedding,
        };
      });

      totalChunkCount += chunks.length;

      documents.push({
        sourceId: src.id,
        title: src.title,
        filename: src.filename,
        mimeType: src.mime_type,
        fileSizeBytes: parseInt(src.file_size_bytes, 10) || 0,
        sha256: src.sha256,
        metadata: src.metadata || {},
        versionNumber: src.version_number,
        chunks,
      });
    }

    // 4. Compute cryptographic SHA-256 package checksum
    const serializedPayload = JSON.stringify(documents);
    const checksum = crypto.createHash('sha256').update(serializedPayload).digest('hex');

    const packageId = crypto.randomUUID();
    const manifest: OfflinePackageManifest = {
      version: '1.0.0',
      packageId,
      exportedAt: new Date().toISOString(),
      sourceWorkspaceId: workspaceId,
      knowledgeSpaceName: ks.name,
      knowledgeSpaceSlug: ks.slug,
      documentCount: documents.length,
      chunkCount: totalChunkCount,
      embeddingModel: config.vector?.defaultModel || 'sentence-transformers/all-MiniLM-L6-v2',
      checksum,
    };

    const pkg: OfflineKnowledgePackage = {
      manifest,
      documents,
    };

    // 5. Optionally save package to disk
    if (saveToDisk) {
      try {
        const outDir = path.resolve(process.cwd(), config.offline.storageDir);
        fs.mkdirSync(outDir, { recursive: true });
        const filePath = path.join(outDir, `${packageId}.nexus-pack.json`);
        fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2), 'utf-8');
        logger.info({ packageId, filePath }, 'Offline knowledge package saved to disk');
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to save offline package file to disk; returning memory payload');
      }
    }

    return pkg;
  }

  /**
   * Imports an offline knowledge package into the target workspace after verifying
   * cryptographic SHA-256 package integrity.
   */
  async importKnowledgePackage(
    pkg: OfflineKnowledgePackage,
    options: {
      targetWorkspaceId: string;
      targetSpaceName?: string;
    }
  ): Promise<KnowledgeImportResult> {
    const { targetWorkspaceId, targetSpaceName } = options;

    if (!pkg || !pkg.manifest || !Array.isArray(pkg.documents)) {
      throw new Error('Invalid offline knowledge package structure: missing manifest or documents array');
    }

    // 1. Cryptographic SHA-256 Integrity Verification
    const serializedPayload = JSON.stringify(pkg.documents);
    const calculatedChecksum = crypto.createHash('sha256').update(serializedPayload).digest('hex');

    if (calculatedChecksum !== pkg.manifest.checksum) {
      throw new Error(
        `Package integrity checksum mismatch! Calculated: ${calculatedChecksum}, Manifest: ${pkg.manifest.checksum}. Package may be corrupted or tampered.`
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 2. Upsert Knowledge Space in target workspace
      const spaceName = targetSpaceName || pkg.manifest.knowledgeSpaceName;
      const spaceSlug = `${pkg.manifest.knowledgeSpaceSlug}-offline-${Date.now().toString(36)}`;

      const ksRes = await client.query(
        `INSERT INTO knowledge_spaces (workspace_id, name, slug, description, status)
         VALUES ($1, $2, $3, 'Imported from offline knowledge package', 'active')
         RETURNING id, name;`,
        [targetWorkspaceId, spaceName, spaceSlug]
      );
      const targetSpaceId = ksRes.rows[0].id;

      let importedDocs = 0;
      let importedChunks = 0;

      // 3. Import each document, version, and chunks
      for (const doc of pkg.documents) {
        const srcRes = await client.query(
          `INSERT INTO document_sources (
             workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9)
           RETURNING id;`,
          [
            targetWorkspaceId,
            targetSpaceId,
            doc.title,
            doc.filename,
            doc.mimeType,
            doc.fileSizeBytes,
            `/storage/offline/${targetWorkspaceId}/${doc.filename}`,
            doc.sha256,
            JSON.stringify(doc.metadata || {}),
          ]
        );
        const sourceId = srcRes.rows[0].id;
        importedDocs++;

        // Insert version
        const verRes = await client.query(
          `INSERT INTO document_versions (source_id, version_number, sha256, status, is_current, metadata)
           VALUES ($1, $2, $3, 'active', TRUE, $4)
           ON CONFLICT DO NOTHING
           RETURNING id;`,
          [sourceId, doc.versionNumber || 1, doc.sha256, JSON.stringify(doc.metadata || {})]
        );
        let versionId = verRes.rows[0]?.id;
        if (!versionId) {
          const v = await client.query(
            `SELECT id FROM document_versions WHERE source_id = $1 AND version_number = $2;`,
            [sourceId, doc.versionNumber || 1]
          );
          versionId = v.rows[0].id;
        }

        // Insert chunks with full-text search tsv and vector embedding
        for (const chunk of doc.chunks) {
          const embeddingStr = chunk.embedding && chunk.embedding.length > 0 ? `[${chunk.embedding.join(',')}]` : null;

          await client.query(
            `INSERT INTO document_chunks (
               workspace_id, knowledge_space_id, source_id, version_id, chunk_index, content, token_count,
               section_path, page_number, source_offset, metadata, embedding
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11,
               $12::vector
             );`,
            [
              targetWorkspaceId,
              targetSpaceId,
              sourceId,
              versionId,
              chunk.chunkIndex,
              chunk.content,
              chunk.tokenCount,
              chunk.sectionPath || null,
              chunk.pageNumber || null,
              chunk.sourceOffset || null,
              JSON.stringify(chunk.metadata || {}),
              embeddingStr,
            ]
          );
          importedChunks++;
        }
      }

      await client.query('COMMIT');

      logger.info(
        { packageId: pkg.manifest.packageId, targetSpaceId, importedDocs, importedChunks },
        'Offline knowledge package successfully imported'
      );

      return {
        status: 'success',
        packageId: pkg.manifest.packageId,
        knowledgeSpaceId: targetSpaceId,
        knowledgeSpaceName: spaceName,
        importedDocuments: importedDocs,
        importedChunks: importedChunks,
        verifiedChecksum: true,
        message: `Successfully imported ${importedDocs} documents and ${importedChunks} chunks into space "${spaceName}".`,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves overall offline system operational status.
   */
  async getSystemOfflineStatus(): Promise<OfflineSystemStatus> {
    let dbConnected = false;
    let vectorReady = false;

    try {
      const res = await this.pool.query('SELECT 1;');
      dbConnected = res.rows.length > 0;
      const vRes = await this.pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector';");
      vectorReady = vRes.rows.length > 0;
    } catch {
      // DB check failure
    }

    return {
      offlineMode: config.offline.enabled,
      airGapped: config.offline.enabled,
      remoteDataAvailable: config.offline.remoteDataEnabled,
      localInferenceOnly: config.inference.localOnly,
      activeInferenceProvider: config.inference.provider,
      embeddingDaemonActive: true,
      databaseConnected: dbConnected,
      vectorExtensionReady: vectorReady,
    };
  }
}
