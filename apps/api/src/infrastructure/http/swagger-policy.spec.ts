import { isSwaggerEnabled } from './swagger-policy';
import type { AppConfig } from '@salon/config';

function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    NODE_ENV: 'development',
    API_PORT: 3000,
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
    JWT_SECRET: 'change-me-in-development-only-min-32-chars',
    JWT_EXPIRES_IN: '8h',
    OUTBOX_BATCH_SIZE: 10,
    OUTBOX_LEASE_MS: 30_000,
    OUTBOX_MAX_ATTEMPTS: 8,
    OUTBOX_BACKOFF_BASE_MS: 500,
    OUTBOX_BACKOFF_CAP_MS: 60_000,
    OUTBOX_POLL_INTERVAL_MS: 1000,
    API_SHUTDOWN_GRACE_MS: 15_000,
    HTTP_TIMEOUT_MS: 5_000,
    HEALTH_CHECK_TIMEOUT_MS: 2_000,
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
