import { loadConfig } from './index';

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
});
