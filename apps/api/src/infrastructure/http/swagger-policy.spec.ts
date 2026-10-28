import { isSwaggerEnabled } from './swagger-policy';
import type { AppConfig } from '@salon/config';

function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    NODE_ENV: 'development',
    API_PORT: 3000,
    CANONICAL_DATABASE_REQUIRED: false,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://salon:salon@localhost:5432/salon',
    DATABASE_POOL_TIMEOUT_SECONDS: 10,
    REDIS_URL: 'redis://localhost:6379',
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
    MINIO_BUCKET: 'salon-platform',
    MINIO_REQUEST_TIMEOUT_MS: 10_000,
    JWT_SECRET: 'change-me-in-development-only-min-32-chars',
    JWT_EXPIRES_IN: '8h',
    OTPY_BASE_URL: 'https://api.otpy.ir',
    OTPY_TIMEOUT_MS: 10_000,
    PUBLIC_REGISTRATION_MODE: 'email',
    PHONE_SIGNUP_ENABLED: false,
    PHONE_SIGNUP_RESEND_COOLDOWN_SECONDS: 60,
    PHONE_SIGNUP_MAX_SENDS: 3,
    PHONE_SIGNUP_SEND_WINDOW_SECONDS: 900,
    PHONE_SIGNUP_MAX_VERIFY_ATTEMPTS: 5,
    PHONE_SIGNUP_MAX_TTL_SECONDS: 180,
    PHONE_SIGNUP_PROOF_TTL_SECONDS: 600,
    AGREEMENT_ACCEPTANCE_ENABLED: false,
    MANUAL_TRANSFER_ENABLED: false,
    AGREEMENT_EVIDENCE_KEY_ID: 'env-1',
    AGREEMENT_PRESENTATION_TTL_SECONDS: 1800,
    TRUSTED_PROXY_HOPS: 0,
    TRUSTED_PROXY_IPS: [],
    API_REVISION: 'unknown',
    OUTBOX_BATCH_SIZE: 10,
    OUTBOX_LEASE_MS: 30_000,
    OUTBOX_MAX_ATTEMPTS: 8,
    OUTBOX_BACKOFF_BASE_MS: 500,
    OUTBOX_BACKOFF_CAP_MS: 60_000,
    OUTBOX_POLL_INTERVAL_MS: 1000,
    OUTBOX_PROCESSED_RETENTION_DAYS: 14,
    IDEMPOTENCY_RETENTION_DAYS: 7,
    RETENTION_CLEANUP_BATCH_SIZE: 1000,
    RETENTION_CLEANUP_INTERVAL_MS: 300_000,
    VIP_UPLOAD_LEASE_MS: 30_000,
    VIP_UPLOAD_RECOVERY_INTERVAL_MS: 30_000,
    VIP_UPLOAD_RECOVERY_BATCH_SIZE: 50,
    VIP_UPLOAD_CLEANUP_SETTLE_MS: 3_600_000,
    API_SHUTDOWN_GRACE_MS: 15_000,
    HTTP_TIMEOUT_MS: 5_000,
    HEALTH_CHECK_TIMEOUT_MS: 2_000,
    BALE_SAFIR_BASE_URL: 'https://safir.bale.ai/api/v3',
    BALE_SAFIR_TIMEOUT_MS: 10_000,
    ...overrides,
  };
}

describe('swagger policy', () => {
  it('is disabled in production unless explicitly enabled', () => {
    expect(isSwaggerEnabled(config({ NODE_ENV: 'production' }))).toBe(false);
    expect(
      isSwaggerEnabled(config({ NODE_ENV: 'production', SWAGGER_ENABLED: true })),
    ).toBe(true);
  });
});
