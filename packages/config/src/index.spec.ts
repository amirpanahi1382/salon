import { getBaleSafirSettings, isSwaggerEnabled, loadConfig } from './index';

describe('loadConfig', () => {
  const valid = {
    DATABASE_URL: 'postgresql://salon:salon@localhost:5432/salon',
    REDIS_URL: 'redis://localhost:6379',
    MINIO_ENDPOINT: 'localhost',
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
    MINIO_BUCKET: 'salon-platform',
    JWT_SECRET: 'change-me-in-development-only-min-32-chars',
  };

  it('loads required values and defaults', () => {
    const config = loadConfig(valid);
    expect(config.API_PORT).toBe(3000);
    expect(config.OUTBOX_BATCH_SIZE).toBe(10);
    expect(config.OUTBOX_PROCESSED_RETENTION_DAYS).toBe(14);
    expect(config.IDEMPOTENCY_RETENTION_DAYS).toBe(7);
    expect(config.MINIO_USE_SSL).toBe(false);
  });

  it('fails fast when JWT_SECRET is too short', () => {
    expect(() =>
      loadConfig({
        ...valid,
        JWT_SECRET: 'short',
      }),
    ).toThrow(/Invalid configuration/);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...rest } = valid;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('enables Swagger by default outside production', () => {
    expect(isSwaggerEnabled(loadConfig(valid))).toBe(true);
    expect(
      isSwaggerEnabled(loadConfig({ ...valid, NODE_ENV: 'production' })),
    ).toBe(false);
    expect(
      isSwaggerEnabled(
        loadConfig({ ...valid, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
      ),
    ).toBe(true);
    expect(
      isSwaggerEnabled(
        loadConfig({ ...valid, NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }),
      ),
    ).toBe(false);
  });

  it('accepts an explicit database pool size', () => {
    const config = loadConfig({ ...valid, DATABASE_CONNECTION_LIMIT: '8' });
    expect(config.DATABASE_CONNECTION_LIMIT).toBe(8);
    expect(config.DATABASE_POOL_TIMEOUT_SECONDS).toBe(10);
  });

  it('treats empty Safir credentials as disabled', () => {
    const config = loadConfig({
      ...valid,
      BALE_SAFIR_API_ACCESS_KEY: '',
      BALE_SAFIR_BOT_ID: '',
    });
    expect(config.BALE_SAFIR_API_ACCESS_KEY).toBeUndefined();
    expect(config.BALE_SAFIR_BOT_ID).toBeUndefined();
    expect(config.BALE_SAFIR_BASE_URL).toBe('https://safir.bale.ai/api/v3');
    expect(getBaleSafirSettings(config)).toBeNull();
  });
});
