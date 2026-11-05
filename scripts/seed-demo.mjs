import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeed() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const sqlPath = path.resolve(__dirname, '../database/seeds/001_seed_demo_showcase.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Seeding demo assistants and knowledge spaces into PostgreSQL...');
  await pool.query(sql);

  const res = await pool.query(
    `SELECT id, name, public_embed_allowed, status FROM assistants 
     WHERE id IN ('4f9d1462-8321-4f11-8be8-2d83ba32d1e0', '91a82f04-8b1e-4509-a1b4-ff70f7d4e320', 'e81a9f04-1111-4509-a1b4-ff70f7d4e320')`
  );

  console.log('Successfully seeded showcase assistants:');
  console.table(res.rows);

  await pool.end();
}

runSeed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});

