import { adaptiveRetrieve } from '../services/api/dist/services/adaptive-retrieval.js';
import {
  deduplicateCandidates,
  validateChunkPermissions,
  getCandidateScore,
  isSubstantialOverlap,
} from '../services/api/dist/services/evidence-assembler.js';
import { pool } from '../services/api/dist/database/pool.js';

const workspaceId = '78e1040e-61f8-4bd0-8b9f-ef3fac1947aa';
const knowledgeSpaceId = '32688276-ae15-4a6a-90ed-a11c4ccbc16d';
const query = 'What are the three primary products offered by NovaTech Solutions? Explain the main purpose of each product.';

async function main() {
  const ad = await adaptiveRetrieve({
    workspaceId,
    knowledgeSpaceId,
    query,
    topK: 5,
  });

  console.log(`=== Adaptive Results: ${ad.results.length} ===`);
  for (const [i, r] of ad.results.entries()) {
    console.log(`[${i}] Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} ID: ${r.chunkId}`);
    console.log(`    Score: ${r.score}, RRF: ${r.rrfScore}, Sem: ${r.similarityScore}, Kw: ${r.keywordScore}`);
    console.log(`    getCandidateScore: ${getCandidateScore(r)}`);
    console.log(`    Content: ${r.content.slice(0, 80).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== Testing Step 1: deduplicateCandidates ===');
  const { deduplicated, droppedCount } = deduplicateCandidates(ad.results);
  console.log(`Deduplicated count: ${deduplicated.length}, Dropped: ${droppedCount}`);
  for (const [i, r] of deduplicated.entries()) {
    console.log(`  [Retained ${i}] Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} ID: ${r.chunkId}`);
  }

  // Check overlap pairwise
  for (let i = 0; i < ad.results.length; i++) {
    for (let j = i + 1; j < ad.results.length; j++) {
      const overlap = isSubstantialOverlap(ad.results[i].content, ad.results[j].content, 0.85);
      if (overlap) {
        console.log(`  OVERLAP detected between Chunk ${ad.results[i].provenance?.chunkIndex} and Chunk ${ad.results[j].provenance?.chunkIndex}!`);
      }
    }
  }

  console.log('\n=== Testing Step 2: validateChunkPermissions ===');
  const chunkIds = deduplicated.map((c) => c.chunkId);
  const validChunkIds = await validateChunkPermissions(chunkIds, workspaceId, knowledgeSpaceId);
  console.log('Valid chunk IDs returned from DB:', validChunkIds);
  for (const r of deduplicated) {
    console.log(`  Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} ID ${r.chunkId} in validSet? ${validChunkIds.has(r.chunkId)}`);
  }

  console.log('\n=== Testing Step 3: minScore Filter ===');
  const minScore = 0.01;
  for (const r of deduplicated) {
    const score = getCandidateScore(r);
    console.log(`  Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} Score: ${score} >= ${minScore}? ${score >= minScore}`);
  }

  console.log('\n=== Testing Step 4: Token budget & selection in assembleEvidence ===');
  let currentTokens = 0;
  const maxTokens = 2000;
  const maxChunks = 5;
  let count = 0;
  for (const c of deduplicated) {
    const tokens = c.tokenCount || Math.ceil(c.content.length / 4);
    console.log(`  Chunk ${c.provenance?.chunkIndex ?? c.chunkIndex}: tokens=${tokens}, currentTokens=${currentTokens}, maxTokens=${maxTokens}`);
    if (currentTokens + tokens > maxTokens) {
      console.log(`    -> EXCEEDED maxTokens!`);
      break;
    }
    if (count >= maxChunks) {
      console.log(`    -> EXCEEDED maxChunks!`);
      break;
    }
    currentTokens += tokens;
    count++;
    console.log(`    -> ACCEPTED!`);
  }

  await pool.end();
}

main().catch(console.error);

