import { describe, it, expect } from 'vitest';
import { runMigrations, getMigrationStatus } from '../src/database/migrate.js';
import { pool } from '../src/database/pool.js';

describe('Database Migration Runner', () => {
  it('reports migration status with applied flag and timestamps', async () => {
    const statuses = await getMigrationStatus();
    expect(statuses.length).toBeGreaterThan(0);
    const foundation = statuses.find((s) => s.file === '001_create_nexus_foundation.sql');
    expect(foundation).toBeDefined();
    expect(foundation?.applied).toBe(true);
    expect(foundation?.appliedAt).toBeDefined();
  });

  it('runs migrations idempotently without re-executing applied migrations', async () => {
    const result = await runMigrations();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('001_create_nexus_foundation.sql');
  });

  it('verifies that schema_migrations table tracks migration history accurately', async () => {
    const res = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version ASC;');
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].version).toBe('001_create_nexus_foundation.sql');
  });
});

