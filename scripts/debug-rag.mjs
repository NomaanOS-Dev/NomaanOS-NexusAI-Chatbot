import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://Nomaan-Nexus:Chatbot-Password@localhost:5434/nomaanos_nexus_ai',
});

async function main() {
  await client.connect();

  const asst = await client.query('SELECT * FROM assistants WHERE id = $1', ['c786fad1-f76d-4027-8409-5554a1be1e79']);
  console.log('Assistant details:', asst.rows[0]);

  // Check recent conversation messages metadata
  const msgs = await client.query(
    `SELECT m.id, m.role, m.metadata, m.token_count, m.created_at
     FROM messages m
     WHERE m.conversation_id = '6a0e434b-532e-4f21-a229-ef4701c1627c'
     ORDER BY m.created_at DESC`
  );
  console.log('Conversation messages with metadata:');
  for (const m of msgs.rows) {
    console.log(`[${m.role}] ID: ${m.id} | Meta:`, JSON.stringify(m.metadata));
  }

  await client.end();
}

main().catch(console.error);
