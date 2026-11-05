import pino from 'pino';
import { config } from './env.js';

const SENSITIVE_PATTERNS = [
  // Password parameters
  {
    regex: /(?:password|passwd|pwd|pass)\s*[:=]\s*(?:'[^']*'|"[^"]*"|\S+)/gi,
    replacement: 'password=[REDACTED_PASSWORD]',
  },
  // Bearer tokens and Authorization headers
  {
    regex: /bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  // API Keys / Secrets
  {
    regex: /(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*(?:'[^']*'|"[^"]*"|[a-zA-Z0-9_\-\.]{8,})/gi,
    replacement: 'secret=[REDACTED_SECRET]',
  },
  // Session cookies / tokens
  {
    regex: /(?:session[_-]?(?:id|token)?|nexus_session|sentinel_session)\s*[:=]\s*[a-zA-Z0-9_\-\.]{16,}/gi,
    replacement: 'session=[REDACTED_SESSION]',
  },
  // Private keys
  {
    regex: /-----BEGIN[ A-Z0-9_-]+KEY-----[\s\S]*?-----END[ A-Z0-9_-]+KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];

/**
 * Sanitizes arbitrary strings by replacing sensitive tokens and credentials with redacted placeholders.
 */
export function redactSensitiveString(text: string | null | undefined): string {
  if (!text) return '';
  let sanitized = String(text);
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-session-token"]',
      'req.body.password',
      'req.body.passwordHash',
      'req.body.token',
      'req.body.sessionToken',
      'req.body.secret',
      'req.body.apiKey',
      'password',
      'passwordHash',
      'token',
      'sessionToken',
      'secret',
      'apiKey',
      'database.password',
      'auth.sessionSecret',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

