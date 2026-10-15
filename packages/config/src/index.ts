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
  MINIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default('8h'),
  /** Server-side OTPy project key. Unset until phone onboarding is enabled. */
  OTPY_API_KEY: z.preprocess((value) => value === '' ? undefined : value,
    z.string().min(1).max(512).optional()),
  OTPY_BASE_URL: z.string().url().default('https://api.otpy.ir'),
  OTPY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(10_000),
  /**
   * Who may create a salon through a public route.
   * `email` is the pre-cutover default and opens POST /auth/register.
   * `phone` closes that route. `closed` closes it as well.
   * Phone-password login is not this setting.
   */
  PUBLIC_REGISTRATION_MODE: z.enum(['email', 'phone', 'closed']).default('email'),
  /**
   * OTP start, verify, and phone-signup completion. Off until rollout.
   * Does not control POST /auth/login/phone or POST /auth/register.
   * May be true only when PUBLIC_REGISTRATION_MODE is phone.
   */
  PHONE_SIGNUP_ENABLED: booleanFromString.default(false),
  /** HMAC secret for phone hashes, request hashes, and signup-proof hashes. Required only when signup is enabled. */
  PHONE_SIGNUP_HASH_SECRET: z.preprocess((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    return value;
  }, z.string().min(32).max(512).optional()),
  PHONE_SIGNUP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(30).max(3600).default(60),
  PHONE_SIGNUP_MAX_SENDS: z.coerce.number().int().min(1).max(10).default(3),
  PHONE_SIGNUP_SEND_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  PHONE_SIGNUP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  /** Local deadline cap. The stored deadline is also never later than OTPy's reported TTL. */
  PHONE_SIGNUP_MAX_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(180),
  PHONE_SIGNUP_PROOF_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
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
  VIP_UPLOAD_LEASE_MS: z.coerce.number().int().min(5_000).max(600_000).default(30_000),
  VIP_UPLOAD_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(5_000).max(86_400_000).default(30_000),
  VIP_UPLOAD_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(50),
  /** Must exceed the object store's maximum time to finish or discard an accepted PUT. */
  VIP_UPLOAD_CLEANUP_SETTLE_MS: z.coerce.number().int().min(60_000).max(604_800_000).default(3_600_000),
  API_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(5_000),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
  /** When unset: enabled outside production. */
  SWAGGER_ENABLED: optionalBooleanFromString,
  /**
   * Platform-level Safir API access key (organization key from Bale business panel).
   * Not per-salon. Empty/unset disables outbound Bale sends.
   */
  BALE_SAFIR_API_ACCESS_KEY: z.preprocess((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    return value;
  }, z.string().min(1).max(512).optional()),
  BALE_SAFIR_BOT_ID: z.preprocess((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    return value;
  }, z.coerce.number().int().positive().optional()),
  BALE_SAFIR_BASE_URL: z.string().url().default('https://safir.bale.ai/api/v3'),
  BALE_SAFIR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  PLATFORM_ADMIN_EMAIL: z.preprocess((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    return value;
  }, z.string().email().max(255).optional()),
  PLATFORM_ADMIN_PASSWORD: z.preprocess((value) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    return value;
  }, z.string().min(12).max(128).optional()),
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
  const email = parsed.data.PLATFORM_ADMIN_EMAIL;
  const password = parsed.data.PLATFORM_ADMIN_PASSWORD;
  if ((email && !password) || (!email && password)) {
    throw new Error(
      'Invalid configuration: PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must both be set or both omitted',
    );
  }
  if (
    parsed.data.PHONE_SIGNUP_ENABLED &&
    parsed.data.PUBLIC_REGISTRATION_MODE !== 'phone'
  ) {
    throw new Error(
      'Invalid configuration: PHONE_SIGNUP_ENABLED requires PUBLIC_REGISTRATION_MODE=phone',
    );
  }
  if (parsed.data.PHONE_SIGNUP_ENABLED && !parsed.data.PHONE_SIGNUP_HASH_SECRET) {
    throw new Error(
      'Invalid configuration: PHONE_SIGNUP_HASH_SECRET is required when PHONE_SIGNUP_ENABLED is true',
    );
  }
  return parsed.data;
}

export function isSwaggerEnabled(config: AppConfig): boolean {
  if (config.SWAGGER_ENABLED !== undefined) {
    return config.SWAGGER_ENABLED;
  }
  return config.NODE_ENV !== 'production';
}

export type BaleSafirSettings = {
  accessKey: string;
  botId: number;
  baseUrl: string;
  timeoutMs: number;
};

/** Platform-level Safir credentials. Missing either key or botId means messaging is disabled. */
export function getBaleSafirSettings(config: AppConfig): BaleSafirSettings | null {
  if (!config.BALE_SAFIR_API_ACCESS_KEY || config.BALE_SAFIR_BOT_ID === undefined) {
    return null;
  }
  return {
    accessKey: config.BALE_SAFIR_API_ACCESS_KEY,
    botId: config.BALE_SAFIR_BOT_ID,
    baseUrl: config.BALE_SAFIR_BASE_URL.replace(/\/$/, ''),
    timeoutMs: config.BALE_SAFIR_TIMEOUT_MS,
  };
}
