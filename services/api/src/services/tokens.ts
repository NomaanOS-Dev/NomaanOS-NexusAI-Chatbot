import crypto from 'crypto';
import { config } from '../config/env.js';

export interface GeneratedToken {
  rawToken: string;
  tokenHash: string;
}

/**
 * Generates an opaque high-entropy 32-byte hexadecimal token and its SHA-256 hash.
 */
export function generateSecureToken(): GeneratedToken {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Computes a SHA-256 hash of a string.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Compares two strings in constant time to prevent timing attacks.
 */
export function timingSafeMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Derives a 32-byte encryption key from the session secret or custom master key.
 */
function getDerivedEncryptionKey(masterKey?: string): Buffer {
  const secret = masterKey || config.auth.sessionSecret;
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts sensitive plaintext (such as third-party API keys) using AES-256-GCM.
 * Format: iv_hex:auth_tag_hex:ciphertext_hex
 */
export function encryptSecret(plaintext: string, masterKey?: string): string {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a non-empty string');
  }

  const key = getDerivedEncryptionKey(masterKey);
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts ciphertext encrypted with AES-256-GCM and verifies authenticity.
 */
export function decryptSecret(encryptedPayload: string, masterKey?: string): string {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Invalid encrypted payload');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getDerivedEncryptionKey(masterKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Masks an API key for safe public or list API display (e.g. sk-...abcd or ****-1234).
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || typeof apiKey !== 'string') return '****';
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '****' + trimmed.slice(-2);
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

