import pg from 'pg';
import { searchKeywordKnowledgeSpace } from '../services/api/dist/services/keyword-search.js';
import { searchKnowledgeSpace as searchVectorKnowledgeSpace } from '../services/api/dist/services/vector-search.js';
import { searchHybridKnowledgeSpace } from '../services/api/dist/services/hybrid-search.js';
import { adaptiveRetrieve } from '../services/api/dist/services/adaptive-retrieval.js';
import { assembleEvidence } from '../services/api/dist/services/evidence-assembler.js';
import { pool } from '../services/api/dist/database/pool.js';

const workspaceId = '78e1040e-61f8-4bd0-8b9f-ef3fac1947aa';
const knowledgeSpaceId = '32688276-ae15-4a6a-90ed-a11c4ccbc16d';

async function main() {
  const qFull = 'What are the three primary products offered by NovaTech Solutions? Explain the main purpose of each product.';
  const qSub1 = 'What are the three primary products offered by NovaTech Solutions';
  const qSub2 = 'Explain the main purpose of each product.';

  console.log('--- Keyword Search for Subquery 1 ---');
  const kw1 = await searchKeywordKnowledgeSpace({
    workspaceId,
    knowledgeSpaceId,
    query: qSub1,
    limit: 5,
  });
  console.log(`Subquery 1 found ${kw1.results.length} chunks:`);
  for (const r of kw1.results) {
    console.log(`  Chunk ${r.provenance.chunkIndex} (Score: ${r.score}): ${r.content.slice(0, 100).replace(/\n/g, ' ')}`);
  }

  console.log('\n--- Keyword Search for Subquery 2 ---');
  const kw2 = await searchKeywordKnowledgeSpace({
    workspaceId,
    knowledgeSpaceId,
    query: qSub2,
    limit: 5,
  });
  console.log(`Subquery 2 found ${kw2.results.length} chunks:`);
  for (const r of kw2.results) {
    console.log(`  Chunk ${r.provenance.chunkIndex} (Score: ${r.score}): ${r.content.slice(0, 100).replace(/\n/g, ' ')}`);
  }

  console.log('\n--- Adaptive Retrieval for Full Query ---');
  const ad = await adaptiveRetrieve({
    workspaceId,
    knowledgeSpaceId,
    query: qFull,
    topK: 5,
  });
  console.log(`Adaptive returned ${ad.results.length} results:`);
  for (const r of ad.results) {
    console.log(`  Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} (Score: ${r.score}, RRF: ${r.rrfScore}, Kw: ${r.keywordScore}, Sem: ${r.similarityScore}): ${r.content.slice(0, 100).replace(/\n/g, ' ')}`);
  }

  console.log('\n--- Assemble Evidence for Full Query ---');
  const ev = await assembleEvidence({
    candidates: ad.results,
    workspaceId,
    knowledgeSpaceId,
    maxTokens: 2000,
    maxChunks: 5,
    minScore: 0.01,
  });
  console.log(`Evidence items count: ${ev.items.length}`);
  for (const item of ev.items) {
    console.log(`  [Citation ${item.citationIndex}] Chunk ${item.chunkIndex}: ${item.content.slice(0, 100).replace(/\n/g, ' ')}`);
  }

  await pool.end();
}

main().catch(console.error);

