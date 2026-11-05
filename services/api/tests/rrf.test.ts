import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, SemanticSearchResultItem, KeywordSearchResultItem } from '../src/services/rrf.js';

describe('Reciprocal Rank Fusion (RRF) Service', () => {
  const dummySource = {
    id: 'src-1',
    title: 'Test Playbook',
    filename: 'test.md',
    versionNumber: 1,
  };

  const dummyProvenance = {
    sectionPath: 'Overview',
    pageNumber: 1,
    sourceOffset: 0,
    chunkIndex: 0,
  };

  it('merges disjoint lists and computes 1 / (k + rank) scores', () => {
    const semantic: SemanticSearchResultItem[] = [
      {
        chunkId: 'chunk-sem-1',
        content: 'Semantic content 1',
        similarityScore: 0.85,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 20,
        metadata: {},
      },
      {
        chunkId: 'chunk-sem-2',
        content: 'Semantic content 2',
        similarityScore: 0.72,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 25,
        metadata: {},
      },
    ];

    const keyword: KeywordSearchResultItem[] = [
      {
        chunkId: 'chunk-kw-1',
        content: 'Keyword content 1',
        keywordScore: 0.9,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 15,
        metadata: {},
      },
    ];

    const fused = reciprocalRankFusion(semantic, keyword, { k: 60 });
    expect(fused).toHaveLength(3);

    // chunk-sem-1: 1/(60+1) = 1/61 = 0.016393
    // chunk-kw-1:  1/(60+1) = 1/61 = 0.016393
    // chunk-sem-2: 1/(60+2) = 1/62 = 0.016129
    expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 5);
    expect(fused[1].rrfScore).toBeCloseTo(1 / 61, 5);
    expect(fused[2].rrfScore).toBeCloseTo(1 / 62, 5);
    expect(fused[2].chunkId).toBe('chunk-sem-2');
  });

  it('deduplicates chunks appearing in both search lists and combines their reciprocal ranks', () => {
    const commonChunkId = 'chunk-shared-alpha';

    const semantic: SemanticSearchResultItem[] = [
      {
        chunkId: commonChunkId,
        content: 'Common chunk content',
        similarityScore: 0.91,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 40,
        metadata: {},
      },
    ];

    const keyword: KeywordSearchResultItem[] = [
      {
        chunkId: commonChunkId,
        content: 'Common chunk content',
        keywordScore: 0.88,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 40,
        metadata: {},
      },
      {
        chunkId: 'chunk-kw-only',
        content: 'Keyword only',
        keywordScore: 0.65,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 10,
        metadata: {},
      },
    ];

    const fused = reciprocalRankFusion(semantic, keyword, { k: 60 });
    // Should be deduplicated into 2 unique chunks
    expect(fused).toHaveLength(2);

    const shared = fused[0];
    expect(shared.chunkId).toBe(commonChunkId);
    // Score should be 1/(60+1) + 1/(60+1) = 2/61 ≈ 0.032787
    expect(shared.rrfScore).toBeCloseTo(2 / 61, 5);
    expect(shared.rankings.rrfRank).toBe(1);
    expect(shared.rankings.semanticRank).toBe(1);
    expect(shared.rankings.keywordRank).toBe(1);
    expect(shared.similarityScore).toBe(0.91);
    expect(shared.keywordScore).toBe(0.88);
  });

  it('applies custom weights and limits output with topK', () => {
    const semantic: SemanticSearchResultItem[] = [
      {
        chunkId: 'chunk-1',
        content: 'Text 1',
        similarityScore: 0.9,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 10,
        metadata: {},
      },
      {
        chunkId: 'chunk-2',
        content: 'Text 2',
        similarityScore: 0.8,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 10,
        metadata: {},
      },
      {
        chunkId: 'chunk-3',
        content: 'Text 3',
        similarityScore: 0.7,
        source: dummySource,
        provenance: dummyProvenance,
        tokenCount: 10,
        metadata: {},
      },
    ];

    const fused = reciprocalRankFusion(semantic, [], {
      k: 60,
      semanticWeight: 2.0,
      topK: 2,
    });

    expect(fused).toHaveLength(2);
    // 2.0 / (60+1) = 2/61 ≈ 0.032787
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61, 5);
  });

  it('handles empty inputs gracefully', () => {
    const fused = reciprocalRankFusion([], []);
    expect(fused).toEqual([]);
  });
});

