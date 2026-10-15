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
    expect(config.MINIO_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(config.OTPY_API_KEY).toBeUndefined();
    expect(config.OTPY_BASE_URL).toBe('https://api.otpy.ir');
    expect(config.OTPY_TIMEOUT_MS).toBe(10_000);
    expect(config.PUBLIC_REGISTRATION_MODE).toBe('email');
    expect(config.PHONE_SIGNUP_ENABLED).toBe(false);
    expect(config.PHONE_SIGNUP_HASH_SECRET).toBeUndefined();
    expect(config.PHONE_SIGNUP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(config.PHONE_SIGNUP_MAX_SENDS).toBe(3);
    expect(config.PHONE_SIGNUP_SEND_WINDOW_SECONDS).toBe(900);
    expect(config.PHONE_SIGNUP_MAX_VERIFY_ATTEMPTS).toBe(5);
    expect(config.PHONE_SIGNUP_MAX_TTL_SECONDS).toBe(180);
    expect(config.PHONE_SIGNUP_PROOF_TTL_SECONDS).toBe(600);
    expect(config.VIP_UPLOAD_LEASE_MS).toBe(30_000);
    expect(config.VIP_UPLOAD_RECOVERY_INTERVAL_MS).toBe(30_000);
    expect(config.VIP_UPLOAD_CLEANUP_SETTLE_MS).toBe(3_600_000);
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

  it('requires the phone-signup hash secret only when the challenge is enabled', () => {
    expect(() =>
      loadConfig({
        ...valid,
        PUBLIC_REGISTRATION_MODE: 'phone',
        PHONE_SIGNUP_ENABLED: 'true',
      }),
    ).toThrow(/PHONE_SIGNUP_HASH_SECRET/);
    const enabled = loadConfig({
      ...valid,
      PUBLIC_REGISTRATION_MODE: 'phone',
      PHONE_SIGNUP_ENABLED: 'true',
      PHONE_SIGNUP_HASH_SECRET: 'phone-signup-hash-secret-at-least-32',
    });
    expect(enabled.PUBLIC_REGISTRATION_MODE).toBe('phone');
    expect(enabled.PHONE_SIGNUP_ENABLED).toBe(true);
    expect(enabled.PHONE_SIGNUP_HASH_SECRET).toBe('phone-signup-hash-secret-at-least-32');
  });

  it('rejects OTP signup unless public registration is phone-only', () => {
    expect(() =>
      loadConfig({
        ...valid,
        PHONE_SIGNUP_ENABLED: 'true',
        PHONE_SIGNUP_HASH_SECRET: 'phone-signup-hash-secret-at-least-32',
      }),
    ).toThrow(/PUBLIC_REGISTRATION_MODE=phone/);
    expect(() =>
      loadConfig({
        ...valid,
        PUBLIC_REGISTRATION_MODE: 'closed',
        PHONE_SIGNUP_ENABLED: 'true',
        PHONE_SIGNUP_HASH_SECRET: 'phone-signup-hash-secret-at-least-32',
      }),
    ).toThrow(/PUBLIC_REGISTRATION_MODE=phone/);
    expect(() =>
      loadConfig({
        ...valid,
        PUBLIC_REGISTRATION_MODE: 'other',
      }),
    ).toThrow(/PUBLIC_REGISTRATION_MODE/);
    expect(
      loadConfig({ ...valid, PUBLIC_REGISTRATION_MODE: 'phone' }).PHONE_SIGNUP_ENABLED,
    ).toBe(false);
    expect(
      loadConfig({ ...valid, PUBLIC_REGISTRATION_MODE: 'closed' }).PUBLIC_REGISTRATION_MODE,
    ).toBe('closed');
  });

  it('treats an empty OTPy project key as unavailable', () => {
    const config = loadConfig({ ...valid, OTPY_API_KEY: '' });
    expect(config.OTPY_API_KEY).toBeUndefined();
  });

  it('requires platform admin email and password together', () => {
    expect(() =>
      loadConfig({
        ...valid,
        PLATFORM_ADMIN_EMAIL: 'ops@example.test',
      }),
    ).toThrow(/PLATFORM_ADMIN_EMAIL/);
  });
});
