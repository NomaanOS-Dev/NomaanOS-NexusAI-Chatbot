import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { logger } from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationStatus {
  file: string;
  applied: boolean;
  appliedAt?: string;
}

export function findMigrationsDir(): string {
  const potentialDirs = [
    path.resolve(__dirname, '../../../../database/migrations'),
    path.resolve(process.cwd(), 'database/migrations'),
    path.resolve(process.cwd(), '../../database/migrations'),
    path.resolve(process.cwd(), '../database/migrations'),
  ];

  const found = potentialDirs.find((dir) => fs.existsSync(dir));
  if (!found) {
    throw new Error(`Migrations directory not found. Checked: ${potentialDirs.join(', ')}`);
  }
  return found;
}

/**
 * Inspects migration files and database records to return current status without applying changes.
 */
export async function getMigrationStatus(): Promise<MigrationStatus[]> {
  const migrationsDir = findMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    // Check if schema_migrations table exists
    const tableExists = await client.query(`
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'schema_migrations';
    `);

    if (tableExists.rows.length === 0) {
      return files.map((file) => ({ file, applied: false }));
    }

    const res = await client.query('SELECT version, applied_at FROM schema_migrations ORDER BY version ASC;');
    const appliedMap = new Map<string, string>(
      res.rows.map((r: { version: string; applied_at: Date }) => [r.version, r.applied_at.toISOString()])
    );

    return files.map((file) => ({
      file,
      applied: appliedMap.has(file),
      appliedAt: appliedMap.get(file),
    }));
  } finally {
    client.release();
  }
}

/**
 * Runs all pending migrations in alphabetical order within a transaction,
 * acquiring a transaction-level advisory lock to prevent concurrent runs.
 */
export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const migrationsDir = findMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('BEGIN');

    // Acquire transaction-level advisory lock on a stable hash to prevent concurrent migrations
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nomaanos_nexus_migrations'));");

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const existingRes = await client.query('SELECT version FROM schema_migrations;');
    const existingSet = new Set(existingRes.rows.map((r: { version: string }) => r.version));

    for (const file of files) {
      if (existingSet.has(file)) {
        skipped.push(file);
        continue;
      }

      logger.info({ migration: file }, `Applying database migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      // Execute migration DDL
      await client.query(sql);

      // Record migration version in history
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      applied.push(file);
    }

    await client.query('COMMIT');
    logger.info({ appliedCount: applied.length, skippedCount: skipped.length }, 'Migration execution completed');
    return { applied, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'Migration failed, transaction rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// Allow direct CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isStatus = process.argv.includes('--status');

  if (isStatus) {
    getMigrationStatus()
      .then((statuses) => {
        console.log('\n--- Nexus AI Database Migration Status ---');
        for (const s of statuses) {
          const mark = s.applied ? '[APPLIED]' : '[PENDING]';
          const time = s.appliedAt ? ` (at ${s.appliedAt})` : '';
          console.log(` ${mark} ${s.file}${time}`);
        }
        console.log('------------------------------------------\n');
        process.exit(0);
      })
      .catch((err) => {
        console.error('Failed to get migration status:', err);
        process.exit(1);
      });
  } else {
    runMigrations()
      .then((result) => {
        console.log('Migrations applied:', result.applied);
        console.log('Migrations skipped (already applied):', result.skipped);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Migration execution failed:', err);
        process.exit(1);
      });
  }
}

