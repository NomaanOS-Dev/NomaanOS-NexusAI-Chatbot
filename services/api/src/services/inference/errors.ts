/**
 * NomaanOS Nexus AI - Inference Error Hierarchy (Day 17)
 */

export class InferenceError extends Error {
  readonly provider: string;
  readonly statusCode: number;
  readonly isRetryable: boolean;

  constructor(message: string, provider: string, statusCode = 500, isRetryable = false) {
    super(message);
    this.name = 'InferenceError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RateLimitError extends InferenceError {
  readonly retryAfterSeconds: number;

  constructor(provider: string, retryAfterSeconds = 30, message?: string) {
    super(
      message || `Inference provider '${provider}' rate limit exceeded. Retry after ${retryAfterSeconds}s.`,
      provider,
      429,
      true
    );
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PolicyViolationError extends InferenceError {
  readonly policy: string;

  constructor(policy: string, message: string) {
    super(message, 'router', 403, false);
    this.name = 'PolicyViolationError';
    this.policy = policy;
  }
}

export class ProviderUnavailableError extends InferenceError {
  constructor(provider: string, message: string, statusCode = 503) {
    super(message, provider, statusCode, true);
    this.name = 'ProviderUnavailableError';
  }
}

export class CredentialsMissingError extends InferenceError {
  constructor(provider: string) {
    super(`Missing required API credentials for provider '${provider}'.`, provider, 401, false);
    this.name = 'CredentialsMissingError';
  }
}

