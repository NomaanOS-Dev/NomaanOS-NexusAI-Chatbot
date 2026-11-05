import { describe, it, expect } from 'vitest';
import { generateChunks, estimateTokens, computeChunkHash } from '../src/services/chunker.js';

describe('Day 7: Structure-Aware Chunking Engine', () => {
  it('handles empty document content gracefully (returns 0 chunks)', () => {
    const chunks = generateChunks(null, '');
    expect(chunks).toEqual([]);

    const emptyBlocks = generateChunks({ blocks: [] }, '   ');
    expect(emptyBlocks).toEqual([]);
  });

  it('chunks a short single-paragraph document into 1 chunk with deterministic hash and tokens', () => {
    const text = 'NomaanOS Nexus AI provides unified intelligence and multi-tenant isolation.';
    const chunks = generateChunks(null, text, 'Architecture Guide');

    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].tokenCount).toBeGreaterThan(5);
    expect(chunks[0].sectionPath).toBe('Architecture Guide');
    expect(chunks[0].chunkHash).toHaveLength(64);
  });

  it('preserves document reading order across multiple paragraphs', () => {
    const p1 = 'First section introduces threat detection models and SIEM data flows.';
    const p2 = 'Second section covers automated incident triage and response playbooks.';
    const p3 = 'Third section discusses forensics memory dump acquisition.';

    const blocks = [
      { block_type: 'paragraph', content: p1 },
      { block_type: 'paragraph', content: p2 },
      { block_type: 'paragraph', content: p3 },
    ];

    const chunks = generateChunks({ blocks }, `${p1}\n\n${p2}\n\n${p3}`, 'SOC Guide', {
      maxChunkSize: 120,
      overlapSize: 20,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Verify deterministic ascending order
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
    // Verify first chunk starts with first paragraph
    expect(chunks[0].content).toContain('First section');
    // Verify last chunk ends with third paragraph
    expect(chunks[chunks.length - 1].content).toContain('Third section');
  });

  it('preserves hierarchical Markdown headings as section paths (Breadcrumbs)', () => {
    const blocks = [
      { block_type: 'heading', content: 'Incident Response', level: 1 },
      { block_type: 'paragraph', content: 'General IR introduction.' },
      { block_type: 'heading', content: 'Step 1: Containment', level: 2 },
      { block_type: 'paragraph', content: 'Immediate network segregation steps.' },
      { block_type: 'heading', content: 'Sub-action A: Ingress Filtering', level: 3 },
      { block_type: 'paragraph', content: 'Drop all inbound packets on external interface.' },
    ];

    const chunks = generateChunks({ blocks }, '', 'Security Runbook');

    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // Chunk 1 should have path 'Security Runbook > Incident Response'
    expect(chunks[0].sectionPath).toBe('Security Runbook > Incident Response');
    expect(chunks[0].content).toContain('General IR introduction');

    // Chunk 2 should have path 'Security Runbook > Incident Response > Step 1: Containment'
    expect(chunks[1].sectionPath).toBe('Security Runbook > Incident Response > Step 1: Containment');
    expect(chunks[1].content).toContain('Immediate network segregation');

    // Chunk 3 should have path 'Security Runbook > Incident Response > Step 1: Containment > Sub-action A: Ingress Filtering'
    expect(chunks[2].sectionPath).toBe(
      'Security Runbook > Incident Response > Step 1: Containment > Sub-action A: Ingress Filtering'
    );
  });

  it('preserves code blocks intact with language metadata', () => {
    const code = 'iptables -A INPUT -p tcp --dport 22 -j DROP\niptables -A INPUT -p tcp --dport 80 -j ACCEPT';
    const blocks = [
      { block_type: 'heading', content: 'Firewall Rules', level: 1 },
      { block_type: 'code', content: code, language: 'bash' },
    ];

    const chunks = generateChunks({ blocks }, '', 'Network Policy');

    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(code);
    expect(chunks[0].metadata.language).toBe('bash');
    expect(chunks[0].metadata.blockTypes).toContain('code');
  });

  it('preserves page numbers for paginated PDF blocks', () => {
    const blocks = [
      { block_type: 'paragraph', content: 'Content on page 1 of regulatory compliance document.', page: 1 },
      { block_type: 'paragraph', content: 'Content on page 2 describing audit certification standards.', page: 2 },
    ];

    const chunks = generateChunks({ blocks }, '', 'Compliance Audit', { maxChunkSize: 100 });

    expect(chunks.length).toBe(2);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[1].pageNumber).toBe(2);
  });

  it('splits an unusually long paragraph on sentence boundaries without corrupting text', () => {
    const sentence1 = 'This is the first long sentence explaining cloud deployment architecture.';
    const sentence2 = 'This is the second long sentence focusing on database replication strategies.';
    const sentence3 = 'This is the third long sentence detailing automated monitoring metrics.';
    const longText = `${sentence1} ${sentence2} ${sentence3}`;

    const blocks = [{ block_type: 'paragraph', content: longText }];

    const chunks = generateChunks({ blocks }, '', 'Cloud SOP', { maxChunkSize: 100, overlapSize: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content).toContain(sentence1);
    expect(chunks.every((c) => c.content.length <= 120)).toBe(true);
  });

  it('produces consistent deterministic chunk hashes and token estimations', () => {
    const content = 'Deterministic hashing verification for knowledge chunks.';
    const hash1 = computeChunkHash(content, 'Section A');
    const hash2 = computeChunkHash(content, 'Section A');
    const hashDiff = computeChunkHash(content, 'Section B');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDiff);
    expect(estimateTokens(content)).toBeGreaterThan(0);
  });
});

