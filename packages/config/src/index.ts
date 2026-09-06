import { z } from 'zod';

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return value === 'true' || value === '1';
  });

const optionalBooleanFromString = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return value === 'true' || value === '1';
  });

const optionalPositiveInt = (max: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    return value;
  }, z.coerce.number().int().min(1).max(max).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1),
  /** Per-process Prisma pool size. Unset = Prisma default. Each API replica and the worker count separately. */
  DATABASE_CONNECTION_LIMIT: optionalPositiveInt(100),
  DATABASE_POOL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(10),
  REDIS_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: booleanFromString.default(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default('8h'),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1000).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  OUTBOX_BACKOFF_BASE_MS: z.coerce.number().int().min(1).default(500),
  OUTBOX_BACKOFF_CAP_MS: z.coerce.number().int().min(1).default(60_000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  /** Keep PROCESSED outbox rows this many days for investigation. DEAD_LETTER is not deleted. */
  OUTBOX_PROCESSED_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** Duplicate Idempotency-Key guarantee window. */
  IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  RETENTION_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(1000),
  RETENTION_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(10_000).max(86_400_000).default(300_000),
  API_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(5_000),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
  /** When unset: enabled outside production. */
  SWAGGER_ENABLED: optionalBooleanFromString,
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export function isSwaggerEnabled(config: AppConfig): boolean {
  if (config.SWAGGER_ENABLED !== undefined) {
    return config.SWAGGER_ENABLED;
  }
  return config.NODE_ENV !== 'production';
}
