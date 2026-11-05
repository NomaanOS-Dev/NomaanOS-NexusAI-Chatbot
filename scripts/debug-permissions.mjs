import pg from 'pg';
import { validateChunkPermissions } from '../services/api/dist/services/evidence-assembler.js';

const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://Nomaan-Nexus:Chatbot-Password@localhost:5434/nomaanos_nexus_ai',
});

async function main() {
  await client.connect();

  const sourceId = 'e2cf7f2e-adef-431a-909f-ecd0f515ac48';
  const workspaceId = '78e1040e-61f8-4bd0-8b9f-ef3fac1947aa';
  const knowledgeSpaceId = '32688276-ae15-4a6a-90ed-a11c4ccbc16d';

  const chunksRes = await client.query('SELECT id, chunk_index FROM document_chunks WHERE source_id = $1', [sourceId]);
  const chunkIds = chunksRes.rows.map((r) => r.id);
  console.log(`Total chunk IDs for NovaTech: ${chunkIds.length}`);

  const validSet = await validateChunkPermissions(chunkIds, workspaceId, knowledgeSpaceId, client);
  console.log(`Valid chunks count from validateChunkPermissions: ${validSet.size} / ${chunkIds.length}`);

  await client.end();
}

main().catch(console.error);

