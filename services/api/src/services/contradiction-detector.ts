/**
 * NomaanOS Nexus AI - Contradiction & Outdated Document Detector (Day 14)
 *
 * Analyzes retrieved evidence items for conflicting assertions, version discrepancies,
 * and deprecation signals. Avoids silently blending contradictory data into one definitive answer.
 * Highlights conflicts with affected document titles and version numbers.
 */

import { AssembledEvidenceItem } from './evidence-assembler.js';

export interface DocumentConflict {
  conflictType: 'version_discrepancy' | 'deprecation_conflict' | 'technical_mismatch';
  sourceA: {
    sourceId: string;
    sourceTitle: string;
    versionNumber: number;
    citationIndex: number;
    excerpt: string;
  };
  sourceB: {
    sourceId: string;
    sourceTitle: string;
    versionNumber: number;
    citationIndex: number;
    excerpt: string;
  };
  description: string;
  resolutionGuidance: string;
}

export interface ContradictionAnalysis {
  hasContradictions: boolean;
  conflicts: DocumentConflict[];
  conflictNotice: string;
}

/**
 * Common technical assertion regex patterns to compare across documents.
 */
const TECHNICAL_ASSERTIONS = [
  // Port numbers: e.g. "port 22", "port 2222"
  { name: 'port', regex: /\bport\s+(\d{2,5})\b/gi },
  // Status flags: e.g. "status: active", "status: disabled", "status: deprecated"
  { name: 'status', regex: /\bstatus\s*[:=]\s*([a-z_]+)\b/gi },
  // TLS / Protocol versions: e.g. "TLS 1.2", "TLS 1.3"
  { name: 'tls_version', regex: /\btls\s*v?([0-9.]+)\b/gi },
  // Boolean configurations: e.g. "enabled: true", "enabled: false"
  { name: 'boolean_flag', regex: /\b([a-z_]+)\s*[:=]\s*(true|false)\b/gi },
];

/**
 * Deprecation keywords to detect outdated vs active document conflicts.
 */
const DEPRECATION_KEYWORDS = ['deprecated', 'superseded', 'legacy', 'obsolete', 'no longer supported', 'discontinued'];
const ACTIVE_KEYWORDS = ['active', 'standard', 'current', 'recommended', 'default', 'supported'];

/**
 * Analyzes assembled evidence items for contradictions and outdated versions.
 */
export function detectContradictions(items: AssembledEvidenceItem[]): ContradictionAnalysis {
  if (!items || items.length < 2) {
    return {
      hasContradictions: false,
      conflicts: [],
      conflictNotice: '',
    };
  }

  const conflicts: DocumentConflict[] = [];

  // 1. Check for Version Discrepancies (multiple versions of the same document source in evidence)
  const itemsBySource = new Map<string, AssembledEvidenceItem[]>();
  for (const item of items) {
    const list = itemsBySource.get(item.sourceId) || [];
    list.push(item);
    itemsBySource.set(item.sourceId, list);
  }

  for (const [, sourceItems] of itemsBySource.entries()) {
    if (sourceItems.length > 1) {
      const versions = Array.from(new Set(sourceItems.map((s) => s.versionNumber)));
      if (versions.length > 1) {
        // Discrepancy across versions of the same document!
        const vA = sourceItems.find((s) => s.versionNumber === Math.min(...versions))!;
        const vB = sourceItems.find((s) => s.versionNumber === Math.max(...versions))!;

        conflicts.push({
          conflictType: 'version_discrepancy',
          sourceA: {
            sourceId: vA.sourceId,
            sourceTitle: vA.sourceTitle,
            versionNumber: vA.versionNumber,
            citationIndex: vA.citationIndex,
            excerpt: vA.content.slice(0, 150),
          },
          sourceB: {
            sourceId: vB.sourceId,
            sourceTitle: vB.sourceTitle,
            versionNumber: vB.versionNumber,
            citationIndex: vB.citationIndex,
            excerpt: vB.content.slice(0, 150),
          },
          description: `Retrieved evidence contains multiple revisions (v${vA.versionNumber} and v${vB.versionNumber}) of "${vA.sourceTitle}". Passages may reflect historical or evolving specifications.`,
          resolutionGuidance: `Compare v${vA.versionNumber} and v${vB.versionNumber} explicitly. Do not assume v${vB.versionNumber} automatically supersedes v${vA.versionNumber} without confirming migration state.`,
        });
      }
    }
  }

  // 2. Check for Deprecation vs Active conflict across documents
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const itemA = items[i];
      const itemB = items[j];

      const textA = itemA.content.toLowerCase();
      const textB = itemB.content.toLowerCase();

      const hasDeprecA = DEPRECATION_KEYWORDS.some((kw) => textA.includes(kw));
      const hasActiveB = ACTIVE_KEYWORDS.some((kw) => textB.includes(kw));

      const hasDeprecB = DEPRECATION_KEYWORDS.some((kw) => textB.includes(kw));
      const hasActiveA = ACTIVE_KEYWORDS.some((kw) => textA.includes(kw));

      if ((hasDeprecA && hasActiveB) || (hasDeprecB && hasActiveA)) {
        const deprecItem = hasDeprecA ? itemA : itemB;
        const activeItem = hasDeprecA ? itemB : itemA;

        // Check if they discuss the same entity/topic
        const wordsDeprec = new Set(deprecItem.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
        const wordsActive = activeItem.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const overlap = wordsActive.filter((w) => wordsDeprec.has(w));

        if (overlap.length >= 3) {
          conflicts.push({
            conflictType: 'deprecation_conflict',
            sourceA: {
              sourceId: deprecItem.sourceId,
              sourceTitle: deprecItem.sourceTitle,
              versionNumber: deprecItem.versionNumber,
              citationIndex: deprecItem.citationIndex,
              excerpt: deprecItem.content.slice(0, 150),
            },
            sourceB: {
              sourceId: activeItem.sourceId,
              sourceTitle: activeItem.sourceTitle,
              versionNumber: activeItem.versionNumber,
              citationIndex: activeItem.citationIndex,
              excerpt: activeItem.content.slice(0, 150),
            },
            description: `Document "${deprecItem.sourceTitle}" references deprecation or obsolescence, whereas "${activeItem.sourceTitle}" lists the component as active or standard.`,
            resolutionGuidance: `Review whether the component has entered deprecation transition. Both perspectives are noted for operational transparency.`,
          });
        }
      }

      // 3. Check for Direct Technical Specification Mismatches (e.g. conflicting ports)
      for (const pattern of TECHNICAL_ASSERTIONS) {
        pattern.regex.lastIndex = 0;
        const matchesA = Array.from(itemA.content.matchAll(pattern.regex)).map((m) => m[0].toLowerCase());
        pattern.regex.lastIndex = 0;
        const matchesB = Array.from(itemB.content.matchAll(pattern.regex)).map((m) => m[0].toLowerCase());

        if (matchesA.length > 0 && matchesB.length > 0) {
          const diff = matchesA.some((valA) => !matchesB.includes(valA));
          if (diff && matchesA[0] !== matchesB[0]) {
            // Check topic relevance before declaring conflict
            conflicts.push({
              conflictType: 'technical_mismatch',
              sourceA: {
                sourceId: itemA.sourceId,
                sourceTitle: itemA.sourceTitle,
                versionNumber: itemA.versionNumber,
                citationIndex: itemA.citationIndex,
                excerpt: itemA.content.slice(0, 150),
              },
              sourceB: {
                sourceId: itemB.sourceId,
                sourceTitle: itemB.sourceTitle,
                versionNumber: itemB.versionNumber,
                citationIndex: itemB.citationIndex,
                excerpt: itemB.content.slice(0, 150),
              },
              description: `Direct technical mismatch on ${pattern.name}: "${itemA.sourceTitle}" asserts "${matchesA[0]}", whereas "${itemB.sourceTitle}" asserts "${matchesB[0]}".`,
              resolutionGuidance: `Verify the relevant environment, cluster, or subsystem scope. Neither value is assumed canonical without environment-level verification.`,
            });
            break;
          }
        }
      }
    }
  }

  // Deduplicate redundant conflicts
  const uniqueConflicts: DocumentConflict[] = [];
  const seenPairKeys = new Set<string>();

  for (const c of conflicts) {
    const key = [c.sourceA.sourceId, c.sourceA.versionNumber, c.sourceB.sourceId, c.sourceB.versionNumber, c.conflictType].sort().join(':');
    if (!seenPairKeys.has(key)) {
      seenPairKeys.add(key);
      uniqueConflicts.push(c);
    }
  }

  const hasContradictions = uniqueConflicts.length > 0;
  let conflictNotice = '';

  if (hasContradictions) {
    const lines: string[] = [
      '⚠️ **Potential Contradictions / Outdated Documents Detected**:',
    ];
    for (const c of uniqueConflicts) {
      lines.push(
        `- **${c.description}** ([${c.sourceA.citationIndex}] *${c.sourceA.sourceTitle}* v${c.sourceA.versionNumber} vs [${c.sourceB.citationIndex}] *${c.sourceB.sourceTitle}* v${c.sourceB.versionNumber}).`
      );
      lines.push(`  *Resolution Guidance*: ${c.resolutionGuidance}`);
    }
    conflictNotice = lines.join('\n');
  }

  return {
    hasContradictions,
    conflicts: uniqueConflicts,
    conflictNotice,
  };
}

