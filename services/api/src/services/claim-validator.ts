/**
 * NomaanOS Nexus AI - Claim-Support Validation Service (Day 14)
 *
 * Verifies that factual assertions made in assistant responses are directly substantiated
 * by the cited evidence passages. Flags unsupported or weakly grounded claims and provides
 * revised/qualified answers with explicit limitation statements.
 */

import { AssembledEvidenceItem } from './evidence-assembler.js';
import { ValidatedCitation } from './citation-validator.js';

export interface EvaluatedClaim {
  claimText: string;
  citedIndices: number[];
  groundingScore: number;
  isSupported: boolean;
  unsupportedReason?: string;
  matchedEvidenceIndex?: number;
}

export interface ClaimValidationResult {
  evaluatedClaims: EvaluatedClaim[];
  overallSupportScore: number;
  hasUnsupportedClaims: boolean;
  qualifiedAnswer: string;
}

/**
 * Calculates token overlap between claim and evidence passage (Jaccard similarity on content words).
 */
export function calculateClaimOverlap(claim: string, evidenceContent: string): number {
  if (!claim || !evidenceContent) return 0.0;

  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const claimWords = normalize(claim);
  const evidenceWords = new Set(normalize(evidenceContent));

  if (claimWords.length === 0) return 0.0;

  let matchCount = 0;
  for (const word of claimWords) {
    if (evidenceWords.has(word)) {
      matchCount++;
    }
  }

  return matchCount / claimWords.length;
}

/**
 * Validates factual claims extracted from the answer against cited evidence.
 */
export function validateClaimSupport(
  answer: string,
  citations: ValidatedCitation[],
  evidenceItems: AssembledEvidenceItem[],
  supportThreshold = 0.35
): ClaimValidationResult {
  if (!answer) {
    return {
      evaluatedClaims: [],
      overallSupportScore: 1.0,
      hasUnsupportedClaims: false,
      qualifiedAnswer: answer,
    };
  }

  // Index evidence by citation index
  const evidenceByIndex = new Map<number, AssembledEvidenceItem>();
  for (const item of evidenceItems) {
    evidenceByIndex.set(item.citationIndex, item);
  }

  // Extract individual sentences or bullet points as candidate factual claims
  const rawLines = answer.split('\n');
  const claimCandidates: { text: string; lineIndex: number; citedIndices: number[] }[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    // Skip empty lines, headers, source listings, disclaimers
    if (
      !line ||
      line.startsWith('#') ||
      line.startsWith('**Verified Sources**') ||
      line.startsWith('⚠️') ||
      line.startsWith('>') ||
      line.startsWith('---') ||
      line.toLowerCase().includes('as the **') ||
      /^\[\d+\]\s*\*\*/.test(line) // Skip source listing lines like "[1] **Document Title**"
    ) {
      continue;
    }

    // Extract bracketed citation numbers: e.g. [1], [2]
    const matches = Array.from(line.matchAll(/\[(\d+)\]/g));
    const citedIndices = matches.map((m) => parseInt(m[1], 10));

    if (line.length > 20) {
      claimCandidates.push({
        text: line,
        lineIndex: i,
        citedIndices,
      });
    }
  }

  const evaluatedClaims: EvaluatedClaim[] = [];
  let totalScore = 0;

  for (const candidate of claimCandidates) {
    let maxScore = 0;
    let bestMatchedIndex: number | undefined;

    if (candidate.citedIndices.length > 0) {
      // Evaluate against explicitly cited evidence items
      for (const idx of candidate.citedIndices) {
        const evidence = evidenceByIndex.get(idx);
        if (evidence) {
          const score = calculateClaimOverlap(candidate.text, evidence.content);
          if (score > maxScore) {
            maxScore = score;
            bestMatchedIndex = idx;
          }
        }
      }
    } else {
      // Uncited claim: check across all evidence items to see if it happens to be grounded
      for (const item of evidenceItems) {
        const score = calculateClaimOverlap(candidate.text, item.content);
        if (score > maxScore) {
          maxScore = score;
          bestMatchedIndex = item.citationIndex;
        }
      }
    }

    const isSupported = maxScore >= supportThreshold;
    const roundedScore = Math.round(maxScore * 1000) / 1000;
    totalScore += roundedScore;

    evaluatedClaims.push({
      claimText: candidate.text,
      citedIndices: candidate.citedIndices,
      groundingScore: roundedScore,
      isSupported,
      unsupportedReason: isSupported
        ? undefined
        : candidate.citedIndices.length === 0
        ? 'Claim has no cited source attribution and low lexical overlap with retrieved evidence'
        : `Cited evidence passage does not establish sufficient overlap with asserted statement (${Math.round(roundedScore * 100)}% overlap)`,
      matchedEvidenceIndex: bestMatchedIndex,
    });
  }

  const overallSupportScore =
    evaluatedClaims.length > 0
      ? Math.round((totalScore / evaluatedClaims.length) * 1000) / 1000
      : 1.0;

  const unsupportedList = evaluatedClaims.filter((c) => !c.isSupported);
  const hasUnsupportedClaims = unsupportedList.length > 0;

  // Revise or qualify answer if unsupported claims exist
  let qualifiedAnswer = answer;
  if (hasUnsupportedClaims) {
    const qualifications: string[] = [
      '',
      '> [!NOTE] **Grounding & Evidence Limitation**',
      '> The following statement(s) could not be definitively verified against authorized documentation and are qualified accordingly:',
    ];

    for (const unsup of unsupportedList) {
      // Clean up citation brackets from claim snippet for readability
      const cleanSnippet = unsup.claimText.replace(/\[\d+\]/g, '').trim();
      qualifications.push(`> - *"${cleanSnippet}"* (${unsup.unsupportedReason})`);
    }

    qualifications.push('> *Policy Notice: Incomplete or unverified claims must not be treated as confirmed operational facts.*');
    qualifiedAnswer = answer + '\n' + qualifications.join('\n');
  }

  return {
    evaluatedClaims,
    overallSupportScore,
    hasUnsupportedClaims,
    qualifiedAnswer,
  };
}
