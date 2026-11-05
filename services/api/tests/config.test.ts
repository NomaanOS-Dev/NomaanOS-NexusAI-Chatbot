import { describe, it, expect } from 'vitest';
import { loadConfig, getSanitizedConfig } from '../src/config/env.js';

describe('Environment Configuration Validation', () => {
  it('loads valid default development configuration', () => {
    const cfg = loadConfig({
      NODE_ENV: 'development',
      API_PORT: '4001',
      DATABASE_PORT: '5434',
      SESSION_SECRET: 'test_session_secret_at_least_16_chars_long',
    });

    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.isProduction).toBe(false);
    expect(cfg.port).toBe(4001);
    expect(cfg.database.port).toBe(5434);
    expect(cfg.database.name).toBe('nomaanos_nexus_ai');
    expect(cfg.vector.dimension).toBe(768);
    expect(cfg.auth.sessionSecret).toBe('test_session_secret_at_least_16_chars_long');
  });

  it('throws descriptive error on invalid port number', () => {
    expect(() =>
      loadConfig({
        API_PORT: '999999', // out of port range
        SESSION_SECRET: 'test_session_secret_at_least_16_chars_long',
      })
    ).toThrow(/Invalid environment variables/);
  });

  it('throws descriptive error when SESSION_SECRET is too short', () => {
    expect(() =>
      loadConfig({
        SESSION_SECRET: 'short',
      })
    ).toThrow(/SESSION_SECRET must be at least 16 characters/);
  });

  it('sanitizes passwords, session secrets, and connection URLs in getSanitizedConfig', () => {
    const cfg = loadConfig({
      DATABASE_PASSWORD: 'super_secret_db_pass',
      SESSION_SECRET: 'super_secret_session_key_12345',
      DATABASE_URL: 'postgresql://nexus_dev:super_secret_db_pass@localhost:5434/nomaanos_nexus_ai',
    });

    const sanitized = getSanitizedConfig(cfg) as any;
    expect(sanitized.database.password).toBe('[REDACTED]');
    expect(sanitized.database.url).not.toContain('super_secret_db_pass');
    expect(sanitized.database.url).toContain('postgresql://[REDACTED]@localhost:5434/nomaanos_nexus_ai');
    expect(sanitized.auth.sessionSecret).toBe('[REDACTED]');
  });
});

