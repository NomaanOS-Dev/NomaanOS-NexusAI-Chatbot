import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z
    .string()
    .default('4001')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(65535)),
  API_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z
    .string()
    .default('5434')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(65535)),
  DATABASE_NAME: z.string().default('nomaanos_nexus_ai'),
  DATABASE_USER: z.string().default('nexus_dev'),
  DATABASE_PASSWORD: z.string().default('nexus_local_dev_secret_2026'),
  DATABASE_URL: z.string().optional(),
  DATABASE_MAX_CONNECTIONS: z
    .string()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  DATABASE_IDLE_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  DATABASE_CONNECTION_TIMEOUT_MS: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  VECTOR_DIMENSION: z
    .string()
    .default('768')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  DEFAULT_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),

  SESSION_SECRET: z
    .string()
    .min(16, { message: 'SESSION_SECRET must be at least 16 characters long' })
    .default('nexus_dev_session_secret_default_change_in_prod'),
  SESSION_COOKIE_NAME: z.string().default('nexus_session'),
  SESSION_EXPIRATION_DAYS: z
    .string()
    .default('7')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  STORAGE_BASE_DIR: z.string().default('storage'),
  MAX_UPLOAD_FILE_BYTES: z
    .string()
    .default('15728640')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  ALLOWED_UPLOAD_EXTENSIONS: z.string().default('.pdf,.md,.txt,.html,.htm,.json,.yaml,.yml,.docx'),

  WORKER_POLL_INTERVAL_MS: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  WORKER_LEASE_DURATION_SECONDS: z
    .string()
    .default('60')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  WORKER_MAX_JOB_ATTEMPTS: z
    .string()
    .default('3')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  INTERNAL_API_KEY: z.string().default('nexus_internal_worker_secret_2026'),
  RERANKER_ENABLED: z.string().default('true').transform((val) => val.toLowerCase() === 'true' || val === '1'),
  RERANKER_MODEL: z.string().default('cross-encoder/ms-marco-MiniLM-L-6-v2'),
  RERANKER_TOP_K: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  RERANKER_CANDIDATE_LIMIT: z
    .string()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  MAX_EVIDENCE_TOKENS: z
    .string()
    .default('2000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  MAX_EVIDENCE_CHUNKS: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  MIN_EVIDENCE_RELEVANCE_SCORE: z
    .string()
    .default('0.01')
    .transform((val) => parseFloat(val))
    .pipe(z.number().min(0).max(1)),

  MEMORY_MAX_MESSAGES: z
    .string()
    .default('10')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  MEMORY_MAX_TOKENS: z
    .string()
    .default('1500')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  MEMORY_AUTO_SUMMARIZE_THRESHOLD: z
    .string()
    .default('8')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  MEMORY_RETENTION_DAYS: z
    .string()
    .default('90')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  DEFAULT_LANGUAGE: z.string().default('en'),
  MULTILINGUAL_ENABLED: z.string().default('true').transform((val) => val.toLowerCase() === 'true' || val === '1'),
  MULTILINGUAL_SUPPORTED_LANGUAGES: z.string().default('en,es,fr,de,ja,zh,pt,ar'),

  // Day 16: Local Model Inference Configuration
  INFERENCE_PROVIDER: z.string().default('ollama'),
  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('qwen3.8:27b'),
  OLLAMA_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  OLLAMA_KEEP_ALIVE: z.string().default('5m'),
  OLLAMA_TEMPERATURE: z
    .string()
    .default('0.2')
    .transform((val) => parseFloat(val))
    .pipe(z.number().min(0).max(2)),
  LOCAL_INFERENCE_ONLY: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true' || val === '1'),

  // Day 17: Cloud Inference & Model Routing Configuration
  MODEL_ROUTING_POLICY: z
    .string()
    .default('local-only'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default('https://api.anthropic.com/v1'),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-haiku-20241022'),
  ANTHROPIC_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  RATE_LIMIT_RETRY_ATTEMPTS: z
    .string()
    .default('2')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().nonnegative()),
  RATE_LIMIT_BASE_DELAY_MS: z
    .string()
    .default('500')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  HYBRID_COMPLEXITY_TOKEN_THRESHOLD: z
    .string()
    .default('300')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  // Day 18: Complete Offline & Air-Gapped Operation Configuration
  OFFLINE_MODE: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true' || val === '1'),
  OFFLINE_STORAGE_DIR: z.string().default('storage/offline_packages'),
  REMOTE_DATA_ENABLED: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true' || val === '1'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  isTest: boolean;
  port: number;
  host: string;
  logLevel: string;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password?: string;
    url: string;
    maxConnections: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  vector: {
    dimension: number;
    defaultModel: string;
  };
  auth: {
    sessionSecret: string;
    sessionCookieName: string;
    sessionExpirationDays: number;
  };
  storage: {
    baseDir: string;
  };
  upload: {
    maxFileBytes: number;
    allowedExtensions: string[];
  };
  worker: {
    pollIntervalMs: number;
    leaseDurationSeconds: number;
    maxJobAttempts: number;
    internalApiKey: string;
  };
  reranker: {
    enabled: boolean;
    model: string;
    topK: number;
    candidateLimit: number;
  };
  evidence: {
    maxTokens: number;
    maxChunks: number;
    minScore: number;
  };
  memory: {
    maxMessages: number;
    maxTokens: number;
    autoSummarizeThreshold: number;
    retentionDays: number;
  };
  multilingual: {
    defaultLanguage: string;
    enabled: boolean;
    supportedLanguages: string[];
  };
  inference: {
    provider: string;
    routingPolicy: 'local-only' | 'cloud-preferred' | 'hybrid' | 'cloud-only';
    ollamaBaseUrl: string;
    ollamaModel: string;
    ollamaTimeoutMs: number;
    ollamaKeepAlive: string;
    ollamaTemperature: number;
    localOnly: boolean;
    openai: {
      apiKey?: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
    };
    anthropic: {
      apiKey?: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
    };
    rateLimit: {
      retryAttempts: number;
      baseDelayMs: number;
    };
    hybrid: {
      complexityTokenThreshold: number;
    };
  };
  offline: {
    enabled: boolean;
    storageDir: string;
    remoteDataEnabled: boolean;
  };
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): AppConfig {
  const result = EnvSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`[Configuration Error] Invalid environment variables:\n${errorDetails}`);
  }

  const data = result.data;
  const isProduction = data.NODE_ENV === 'production';
  const isTest = data.NODE_ENV === 'test';

  if (data.OFFLINE_MODE) {
    process.env.TRANSFORMERS_OFFLINE = '1';
    process.env.HF_HUB_OFFLINE = '1';
    process.env.NEXUS_OFFLINE_MODE = 'true';
  }

  const dbUrl =
    data.DATABASE_URL ||
    `postgresql://${data.DATABASE_USER}:${data.DATABASE_PASSWORD}@${data.DATABASE_HOST}:${data.DATABASE_PORT}/${data.DATABASE_NAME}`;

  const allowedExtensions = data.ALLOWED_UPLOAD_EXTENSIONS.split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);

  return {
    nodeEnv: data.NODE_ENV,
    isProduction,
    isTest,
    port: data.API_PORT,
    host: data.API_HOST,
    logLevel: data.LOG_LEVEL,
    database: {
      host: data.DATABASE_HOST,
      port: data.DATABASE_PORT,
      name: data.DATABASE_NAME,
      user: data.DATABASE_USER,
      password: data.DATABASE_PASSWORD,
      url: dbUrl,
      maxConnections: data.DATABASE_MAX_CONNECTIONS,
      idleTimeoutMs: data.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: data.DATABASE_CONNECTION_TIMEOUT_MS,
    },
    vector: {
      dimension: data.VECTOR_DIMENSION,
      defaultModel: data.DEFAULT_EMBEDDING_MODEL,
    },
    auth: {
      sessionSecret: data.SESSION_SECRET,
      sessionCookieName: data.SESSION_COOKIE_NAME,
      sessionExpirationDays: data.SESSION_EXPIRATION_DAYS,
    },
    storage: {
      baseDir: data.STORAGE_BASE_DIR,
    },
    upload: {
      maxFileBytes: data.MAX_UPLOAD_FILE_BYTES,
      allowedExtensions,
    },
    worker: {
      pollIntervalMs: data.WORKER_POLL_INTERVAL_MS,
      leaseDurationSeconds: data.WORKER_LEASE_DURATION_SECONDS,
      maxJobAttempts: data.WORKER_MAX_JOB_ATTEMPTS,
      internalApiKey: data.INTERNAL_API_KEY,
    },
    reranker: {
      enabled: data.RERANKER_ENABLED,
      model: data.RERANKER_MODEL,
      topK: data.RERANKER_TOP_K,
      candidateLimit: data.RERANKER_CANDIDATE_LIMIT,
    },
    evidence: {
      maxTokens: data.MAX_EVIDENCE_TOKENS,
      maxChunks: data.MAX_EVIDENCE_CHUNKS,
      minScore: data.MIN_EVIDENCE_RELEVANCE_SCORE,
    },
    memory: {
      maxMessages: data.MEMORY_MAX_MESSAGES,
      maxTokens: data.MEMORY_MAX_TOKENS,
      autoSummarizeThreshold: data.MEMORY_AUTO_SUMMARIZE_THRESHOLD,
      retentionDays: data.MEMORY_RETENTION_DAYS,
    },
    multilingual: {
      defaultLanguage: data.DEFAULT_LANGUAGE,
      enabled: data.MULTILINGUAL_ENABLED,
      supportedLanguages: data.MULTILINGUAL_SUPPORTED_LANGUAGES.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean),
    },
    inference: {
      provider: data.INFERENCE_PROVIDER,
      routingPolicy: (data.MODEL_ROUTING_POLICY.replace('_', '-') as any) || 'local-only',
      ollamaBaseUrl: data.OLLAMA_BASE_URL,
      ollamaModel: data.OLLAMA_MODEL,
      ollamaTimeoutMs: data.OLLAMA_TIMEOUT_MS,
      ollamaKeepAlive: data.OLLAMA_KEEP_ALIVE,
      ollamaTemperature: data.OLLAMA_TEMPERATURE,
      localOnly: data.LOCAL_INFERENCE_ONLY,
      openai: {
        apiKey: data.OPENAI_API_KEY,
        baseUrl: data.OPENAI_BASE_URL,
        model: data.OPENAI_MODEL,
        timeoutMs: data.OPENAI_TIMEOUT_MS,
      },
      anthropic: {
        apiKey: data.ANTHROPIC_API_KEY,
        baseUrl: data.ANTHROPIC_BASE_URL,
        model: data.ANTHROPIC_MODEL,
        timeoutMs: data.ANTHROPIC_TIMEOUT_MS,
      },
      rateLimit: {
        retryAttempts: data.RATE_LIMIT_RETRY_ATTEMPTS,
        baseDelayMs: data.RATE_LIMIT_BASE_DELAY_MS,
      },
      hybrid: {
        complexityTokenThreshold: data.HYBRID_COMPLEXITY_TOKEN_THRESHOLD,
      },
    },
    offline: {
      enabled: data.OFFLINE_MODE,
      storageDir: data.OFFLINE_STORAGE_DIR,
      remoteDataEnabled: data.REMOTE_DATA_ENABLED,
    },
  };
}

// Global cached config
export const config: AppConfig = loadConfig();

/**
 * Returns a sanitized clone of the configuration suitable for logging.
 */
export function getSanitizedConfig(cfg: AppConfig = config): Record<string, unknown> {
  return {
    nodeEnv: cfg.nodeEnv,
    port: cfg.port,
    host: cfg.host,
    logLevel: cfg.logLevel,
    database: {
      host: cfg.database.host,
      port: cfg.database.port,
      name: cfg.database.name,
      user: cfg.database.user,
      password: '[REDACTED]',
      url: cfg.database.url.replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[REDACTED]@'),
      maxConnections: cfg.database.maxConnections,
    },
    vector: cfg.vector,
    auth: {
      sessionCookieName: cfg.auth.sessionCookieName,
      sessionExpirationDays: cfg.auth.sessionExpirationDays,
      sessionSecret: '[REDACTED]',
    },
    storage: cfg.storage,
    upload: cfg.upload,
    worker: cfg.worker,
    reranker: cfg.reranker,
    evidence: cfg.evidence,
    memory: cfg.memory,
    multilingual: cfg.multilingual,
    inference: {
      provider: cfg.inference.provider,
      routingPolicy: cfg.inference.routingPolicy,
      ollamaBaseUrl: cfg.inference.ollamaBaseUrl,
      ollamaModel: cfg.inference.ollamaModel,
      ollamaTimeoutMs: cfg.inference.ollamaTimeoutMs,
      ollamaKeepAlive: cfg.inference.ollamaKeepAlive,
      ollamaTemperature: cfg.inference.ollamaTemperature,
      localOnly: cfg.inference.localOnly,
      openai: {
        apiKey: cfg.inference.openai.apiKey ? '[REDACTED]' : undefined,
        baseUrl: cfg.inference.openai.baseUrl,
        model: cfg.inference.openai.model,
        timeoutMs: cfg.inference.openai.timeoutMs,
      },
      anthropic: {
        apiKey: cfg.inference.anthropic.apiKey ? '[REDACTED]' : undefined,
        baseUrl: cfg.inference.anthropic.baseUrl,
        model: cfg.inference.anthropic.model,
        timeoutMs: cfg.inference.anthropic.timeoutMs,
      },
      rateLimit: cfg.inference.rateLimit,
      hybrid: cfg.inference.hybrid,
    },
    offline: cfg.offline,
  };
}

