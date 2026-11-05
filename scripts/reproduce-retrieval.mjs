import { adaptiveRetrieve } from '../services/api/dist/services/adaptive-retrieval.js';
import { searchHybridKnowledgeSpace } from '../services/api/dist/services/hybrid-search.js';
import { searchKeywordKnowledgeSpace } from '../services/api/dist/services/keyword-search.js';
import { searchKnowledgeSpace as searchVectorKnowledgeSpace } from '../services/api/dist/services/vector-search.js';
import { assembleEvidence } from '../services/api/dist/services/evidence-assembler.js';
import { analyzeQuery } from '../services/api/dist/services/query-understanding.js';
import { pool } from '../services/api/dist/database/pool.js';

const workspaceId = '78e1040e-61f8-4bd0-8b9f-ef3fac1947aa';
const knowledgeSpaceId = '32688276-ae15-4a6a-90ed-a11c4ccbc16d';
const query = 'What are the three primary products offered by NovaTech Solutions? Explain the main purpose of each product.';

async function run() {
  console.log('=== STEP 1: Query Understanding ===');
  const analysis = analyzeQuery(query);
  console.log('Classification:', JSON.stringify(analysis.classification));
  console.log('Decomposition:', JSON.stringify(analysis.decomposition));
  console.log('Rewriting:', JSON.stringify(analysis.rewriting));

  console.log('\n=== STEP 2: Keyword Search (Direct Query) ===');
  const kwRes = await searchKeywordKnowledgeSpace({
    workspaceId,
    knowledgeSpaceId,
    query,
    limit: 10,
  });
  console.log(`Keyword results count: ${kwRes.results.length}`);
  for (const r of kwRes.results) {
    console.log(`[Chunk ${r.provenance.chunkIndex} / Rank ${r.rank}] Score: ${r.score} | ID: ${r.chunkId}`);
    console.log(`  Content: ${r.content.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== STEP 3: Vector Search (Direct Query) ===');
  const vecRes = await searchVectorKnowledgeSpace({
    workspaceId,
    knowledgeSpaceId,
    query,
    limit: 10,
  });
  console.log(`Vector results count: ${vecRes.results.length}`);
  for (const r of vecRes.results) {
    console.log(`[Chunk ${r.provenance.chunkIndex}] Cosine: ${r.similarityScore} | ID: ${r.chunkId}`);
    console.log(`  Content: ${r.content.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== STEP 4: Hybrid Search (Direct Query) ===');
  const hybridRes = await searchHybridKnowledgeSpace({
    workspaceId,
    knowledgeSpaceId,
    query,
    topK: 10,
  });
  console.log(`Hybrid results count: ${hybridRes.results.length}`);
  for (const r of hybridRes.results) {
    console.log(`[Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} / Rank ${r.rank}] Final: ${r.score} (RRF: ${r.rrfScore}, Sem: ${r.similarityScore}, Kw: ${r.keywordScore}) | ID: ${r.chunkId}`);
    console.log(`  Content: ${r.content.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== STEP 5: Adaptive Retrieval ===');
  const adaptiveRes = await adaptiveRetrieve({
    workspaceId,
    knowledgeSpaceId,
    query,
    topK: 10,
  });
  console.log(`Adaptive results count: ${adaptiveRes.results.length}`);
  for (const r of adaptiveRes.results) {
    console.log(`[Chunk ${r.provenance?.chunkIndex ?? r.chunkIndex} / Rank ${r.rank}] Score: ${r.score} | ID: ${r.chunkId}`);
    console.log(`  Content: ${r.content.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== STEP 6: Evidence Assembler ===');
  const evidenceRes = await assembleEvidence({
    candidates: adaptiveRes.results,
    workspaceId,
    knowledgeSpaceId,
    maxTokens: 4000,
    maxChunks: 8,
    minScore: 0.1,
  });
  console.log(`Assembled items count: ${evidenceRes.items.length}`);
  for (const item of evidenceRes.items) {
    console.log(`[Citation ${item.citationIndex}] Chunk ${item.chunkIndex} | Score: ${item.relevanceScore} | ID: ${item.chunkId}`);
    console.log(`  Content: ${item.content.slice(0, 150).replace(/\n/g, ' ')}`);
  }

  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
