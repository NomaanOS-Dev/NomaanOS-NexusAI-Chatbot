import { describe, it, expect } from 'vitest';
import { redactSensitiveString } from '../src/config/logger.js';

describe('Structured Logger Sensitive Data Redaction', () => {
  it('redacts password parameters from logs', () => {
    const raw = 'Login failed for user admin with password=SecretPassword123!';
    const redacted = redactSensitiveString(raw);
    expect(redacted).not.toContain('SecretPassword123!');
    expect(redacted).toContain('password=[REDACTED_PASSWORD]');
  });

  it('redacts Bearer tokens from authorization headers', () => {
    const raw = 'Incoming request with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
    const redacted = redactSensitiveString(raw);
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(redacted).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('redacts API keys and secrets', () => {
    const raw = 'Configured upstream with api_key=sk-1234567890abcdef and secret=secret_value_98765';
    const redacted = redactSensitiveString(raw);
    expect(redacted).not.toContain('sk-1234567890abcdef');
    expect(redacted).not.toContain('secret_value_98765');
    expect(redacted).toContain('secret=[REDACTED_SECRET]');
  });

  it('redacts session cookies', () => {
    const raw = 'Cookie parsed: nexus_session=0123456789abcdef0123456789abcdef';
    const redacted = redactSensitiveString(raw);
    expect(redacted).not.toContain('0123456789abcdef0123456789abcdef');
    expect(redacted).toContain('session=[REDACTED_SESSION]');
  });

  it('redacts private keys', () => {
    const raw = 'Key dump: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----';
    const redacted = redactSensitiveString(raw);
    expect(redacted).not.toContain('MIIEowIBAAKCAQEA0');
    expect(redacted).toBe('Key dump: [REDACTED_PRIVATE_KEY]');
  });
});

