import crypto from 'crypto';

export interface ChunkOptions {
  maxChunkSize?: number; // Characters per chunk (default 800)
  overlapSize?: number; // Overlap characters (default 150)
}

export interface ChunkRecord {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  chunkHash: string;
  sectionPath: string | null;
  pageNumber: number | null;
  sourceOffset: number;
  metadata: Record<string, any>;
}

export interface StructuredBlock {
  block_type: string;
  content: string;
  level?: number;
  language?: string;
  page?: number;
  metadata?: Record<string, any>;
}

export interface ExtractedDocumentData {
  schema_version?: string;
  format?: string;
  blocks?: StructuredBlock[];
  headings?: Array<{ title: string; level: number; page?: number }>;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  code_blocks?: Array<{ code: string; language?: string }>;
  page_references?: number[];
  metadata?: Record<string, any>;
}

/**
 * Estimates token count from content string (~4 characters per token heuristic).
 */
export function estimateTokens(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  return Math.max(words, Math.ceil(chars / 4));
}

/**
 * Computes deterministic SHA-256 hash for chunk content and its section context.
 */
export function computeChunkHash(content: string, sectionPath?: string | null): string {
  const normalized = `${sectionPath || ''}:::${content.trim()}`;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Splits oversized continuous text into natural sentence boundaries.
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries while keeping punctuation
  const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Structure-aware chunking algorithm:
 * 1. Traverses structured blocks in document reading order.
 * 2. Maintains hierarchical heading breadcrumbs (e.g. "Doc Title > Section 1 > Subsection A").
 * 3. Keeps tables and code blocks intact unless they exceed maxChunkSize.
 * 4. Combines natural paragraphs up to maxChunkSize with sliding overlap.
 * 5. Deterministically calculates offsets, page numbers, hashes, and token counts.
 */
export function generateChunks(
  extractedData: ExtractedDocumentData | null | undefined,
  normalizedText: string,
  docTitle?: string,
  options: ChunkOptions = {}
): ChunkRecord[] {
  const maxChunkSize = options.maxChunkSize || 800;
  const overlapSize = options.overlapSize !== undefined ? options.overlapSize : 150;

  const chunks: ChunkRecord[] = [];
  const blocks = extractedData?.blocks || [];

  // Fallback if no structured blocks exist (treat whole normalized text as paragraphs)
  if (blocks.length === 0) {
    if (!normalizedText || normalizedText.trim().length === 0) {
      return [];
    }

    const rawParagraphs = normalizedText
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    let currentChunk = '';
    let currentOffset = 0;
    let chunkOffset = 0;
    let chunkIdx = 0;

    for (const para of rawParagraphs) {
      if (currentChunk.length > 0 && currentChunk.length + para.length + 2 > maxChunkSize) {
        // Emit current chunk
        const content = currentChunk.trim();
        chunks.push({
          chunkIndex: chunkIdx++,
          content,
          tokenCount: estimateTokens(content),
          chunkHash: computeChunkHash(content, docTitle || null),
          sectionPath: docTitle || null,
          pageNumber: null,
          sourceOffset: chunkOffset,
          metadata: { blockTypes: ['paragraph'] },
        });

        // Compute overlap for sliding window
        if (overlapSize > 0 && currentChunk.length > overlapSize) {
          const overlapText = currentChunk.slice(-overlapSize).trim();
          currentChunk = overlapText ? overlapText + '\n\n' + para : para;
        } else {
          currentChunk = para;
        }
        chunkOffset = currentOffset;
      } else {
        if (currentChunk.length === 0) {
          chunkOffset = currentOffset;
          currentChunk = para;
        } else {
          currentChunk += '\n\n' + para;
        }
      }
      currentOffset += para.length + 2;
    }

    if (currentChunk.trim().length > 0) {
      const content = currentChunk.trim();
      chunks.push({
        chunkIndex: chunkIdx++,
        content,
        tokenCount: estimateTokens(content),
        chunkHash: computeChunkHash(content, docTitle || null),
        sectionPath: docTitle || null,
        pageNumber: null,
        sourceOffset: chunkOffset,
        metadata: { blockTypes: ['paragraph'] },
      });
    }

    return chunks;
  }

  // --- Structure-Aware Block Processing ---
  const headingStack: Array<{ level: number; title: string }> = [];
  if (docTitle) {
    headingStack.push({ level: 0, title: docTitle });
  }

  function getCurrentSectionPath(): string | null {
    if (headingStack.length === 0) return null;
    return headingStack.map((h) => h.title).join(' > ');
  }

  let chunkIdx = 0;
  let runningOffset = 0;

  let accumulator = '';
  let accumulatorOffset = 0;
  let accumulatorPage: number | null = null;
  let accumulatorBlockTypes = new Set<string>();
  let currentSectionPath = getCurrentSectionPath();

  function flushAccumulator() {
    if (!accumulator.trim()) return;
    const content = accumulator.trim();
    chunks.push({
      chunkIndex: chunkIdx++,
      content,
      tokenCount: estimateTokens(content),
      chunkHash: computeChunkHash(content, currentSectionPath),
      sectionPath: currentSectionPath,
      pageNumber: accumulatorPage,
      sourceOffset: accumulatorOffset,
      metadata: {
        blockTypes: Array.from(accumulatorBlockTypes),
      },
    });

    accumulator = '';
    accumulatorPage = null;
    accumulatorBlockTypes.clear();
  }

  for (const block of blocks) {
    const blockContent = block.content?.trim() || '';
    if (!blockContent) continue;

    const blockType = block.block_type || 'paragraph';

    // 1. Heading block: Updates hierarchical section path breadcrumbs
    if (blockType === 'heading') {
      flushAccumulator();

      const level = block.level || 1;
      // Pop deeper or equal headings from stack
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title: blockContent });
      currentSectionPath = getCurrentSectionPath();

      runningOffset += blockContent.length + 1;
      continue;
    }

    const blockPage = block.page !== undefined && block.page !== null ? block.page : null;

    // 2. Self-contained large structured blocks (Tables and Code blocks)
    if (blockType === 'table' || blockType === 'code') {
      flushAccumulator();

      if (blockContent.length <= maxChunkSize) {
        chunks.push({
          chunkIndex: chunkIdx++,
          content: blockContent,
          tokenCount: estimateTokens(blockContent),
          chunkHash: computeChunkHash(blockContent, currentSectionPath),
          sectionPath: currentSectionPath,
          pageNumber: block.page || null,
          sourceOffset: runningOffset,
          metadata: {
            blockTypes: [blockType],
            language: block.language || null,
            ...(block.metadata || {}),
          },
        });
        runningOffset += blockContent.length + 2;
        continue;
      }
    }

    // 3. Very long single block exceeding maxChunkSize: split along sentence boundaries
    if (blockContent.length > maxChunkSize) {
      flushAccumulator();
      const sentences = splitIntoSentences(blockContent);
      let subChunk = '';
      let subOffset = runningOffset;

      for (const sent of sentences) {
        if (subChunk.length > 0 && subChunk.length + sent.length + 1 > maxChunkSize) {
          const content = subChunk.trim();
          chunks.push({
            chunkIndex: chunkIdx++,
            content,
            tokenCount: estimateTokens(content),
            chunkHash: computeChunkHash(content, currentSectionPath),
            sectionPath: currentSectionPath,
            pageNumber: block.page || null,
            sourceOffset: subOffset,
            metadata: { blockTypes: [blockType] },
          });

          // Overlap window
          if (overlapSize > 0 && subChunk.length > overlapSize) {
            subChunk = subChunk.slice(-overlapSize).trim() + ' ' + sent;
          } else {
            subChunk = sent;
          }
          subOffset = runningOffset;
        } else {
          subChunk = subChunk ? subChunk + ' ' + sent : sent;
        }
      }

      if (subChunk.trim().length > 0) {
        const content = subChunk.trim();
        chunks.push({
          chunkIndex: chunkIdx++,
          content,
          tokenCount: estimateTokens(content),
          chunkHash: computeChunkHash(content, currentSectionPath),
          sectionPath: currentSectionPath,
          pageNumber: block.page || null,
          sourceOffset: subOffset,
          metadata: { blockTypes: [blockType] },
        });
      }

      runningOffset += blockContent.length + 2;
      continue;
    }

    // 4. Normal paragraph / list / key-value block: Accumulate with sliding window
    const currentLen = accumulator.length;
    const pageChanged = blockPage !== null && accumulatorPage !== null && blockPage !== accumulatorPage;

    if (currentLen > 0 && (currentLen + blockContent.length + 2 > maxChunkSize || pageChanged)) {
      flushAccumulator();

      // Sliding overlap only when not crossing distinct page boundary
      if (!pageChanged && overlapSize > 0 && accumulator.length > overlapSize) {
        const overlap = accumulator.slice(-overlapSize).trim();
        accumulator = overlap ? overlap + '\n\n' + blockContent : blockContent;
      } else {
        accumulator = blockContent;
      }
      accumulatorOffset = runningOffset;
      accumulatorPage = blockPage;
      accumulatorBlockTypes.add(blockType);
    } else {
      if (accumulator.length === 0) {
        accumulator = blockContent;
        accumulatorOffset = runningOffset;
        accumulatorPage = blockPage;
      } else {
        accumulator += '\n\n' + blockContent;
      }
      accumulatorBlockTypes.add(blockType);
    }

    runningOffset += blockContent.length + 2;
  }

  flushAccumulator();
  return chunks;
}
