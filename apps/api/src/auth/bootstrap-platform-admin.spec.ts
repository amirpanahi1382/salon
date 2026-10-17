import { bootstrapPlatformAdmin } from './bootstrap-platform-admin';

const { assertBootstrapDatabaseAllowed } = require('../../scripts/bootstrap-platform-admin.cjs') as {
  assertBootstrapDatabaseAllowed: (databaseUrl: string, confirm: string | undefined) => void;
};
import { listenApi } from './listen-api';
import { PlatformAdminLoginUseCase } from './platform-admin-login.use-case';

describe('bootstrapPlatformAdmin', () => {
  const hashPassword = jest.fn(async (password: string) => `hash:${password}`);
  const createId = () => '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    hashPassword.mockClear();
  });

  function prismaMock(existingId?: string) {
    return {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue(existingId ? { id: existingId } : null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it('skips in production even when credentials are present', async () => {
    const prisma = prismaMock();
    const result = await bootstrapPlatformAdmin({
      prisma: prisma as never,
      nodeEnv: 'production',
      email: 'admin@salon.local',
      password: 'development-admin-pass',
      hashPassword,
      createId,
    });
    expect(result.outcome).toBe('skipped');
    expect(prisma.platformAdmin.findUnique).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('skips when credentials are omitted', async () => {
    const prisma = prismaMock();
    const result = await bootstrapPlatformAdmin({
      prisma: prisma as never,
      nodeEnv: 'development',
      email: undefined,
      password: undefined,
      hashPassword,
      createId,
    });
    expect(result).toEqual({
      outcome: 'skipped',
      reason:
        'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must both be set for development bootstrap',
    });
  });

  it('creates a development admin once', async () => {
    const prisma = prismaMock();
    const result = await bootstrapPlatformAdmin({
      prisma: prisma as never,
      nodeEnv: 'development',
      email: ' Admin@salon.local ',
      password: 'development-admin-pass',
      hashPassword,
      createId,
    });
    expect(result).toEqual({ outcome: 'created', email: 'admin@salon.local' });
    expect(prisma.platformAdmin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'admin@salon.local',
        passwordHash: 'hash:development-admin-pass',
        name: 'Platform Admin',
      }),
    });
  });

  it('explicit bootstrap still updates an existing admin instead of inserting a duplicate', async () => {
    const prisma = prismaMock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const result = await bootstrapPlatformAdmin({
      prisma: prisma as never,
      nodeEnv: 'development',
      email: 'admin@salon.local',
      password: 'development-admin-pass',
      hashPassword,
      createId,
    });
    expect(result.outcome).toBe('updated');
    expect(prisma.platformAdmin.create).not.toHaveBeenCalled();
    expect(prisma.platformAdmin.update).toHaveBeenCalled();
  });
});

describe('API startup leaves existing platform admin credentials unchanged', () => {
  const previousEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const previousPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  const previousPort = process.env.API_PORT;

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAIL = 'admin@salon.local';
    process.env.PLATFORM_ADMIN_PASSWORD = 'development-admin-pass';
    process.env.API_PORT = '3000';
  });

  afterEach(() => {
    restoreEnv('PLATFORM_ADMIN_EMAIL', previousEmail);
    restoreEnv('PLATFORM_ADMIN_PASSWORD', previousPassword);
    restoreEnv('API_PORT', previousPort);
  });

  function adminDb() {
    return {
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    };
  }

  function startup() {
    const admin = adminDb();
    const useCase = new PlatformAdminLoginUseCase(
      { client: { platformAdmin: admin } } as never,
      { signAsync: jest.fn() } as never,
    );
    return { admin, useCase };
  }

  it('does not rotate an existing admin when inherited bootstrap credentials are present', async () => {
    const { admin, useCase } = startup();
    await useCase.onModuleInit();
    await listenApi(async () => undefined, Number(process.env.API_PORT));
    expect(admin.findUnique).not.toHaveBeenCalled();
    expect(admin.update).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('listens on the port alone unless a loopback host is supplied', async () => {
    const listen = jest.fn(async () => undefined);
    await listenApi(listen, 3010);
    expect(listen.mock.calls).toEqual([[3010]]);
    listen.mockClear();
    await listenApi(listen, 3011, '127.0.0.1');
    expect(listen.mock.calls).toEqual([[3011, '127.0.0.1']]);
  });

  it('does not rotate an existing admin when the listen port is already in use', async () => {
    const { admin, useCase } = startup();
    await useCase.onModuleInit();
    await expect(
      listenApi(async () => {
        throw Object.assign(new Error('listen EADDRINUSE: address already in use :::3000'), {
          code: 'EADDRINUSE',
        });
      }, 3000),
    ).rejects.toThrow(/EADDRINUSE/);
    expect(admin.update).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
    expect(admin.findUnique).not.toHaveBeenCalled();
  });
});

describe('explicit bootstrap database guard', () => {
  const persistent = 'postgresql://salon:placeholder@127.0.0.1:5432/salon?schema=public';

  it('refuses persistent salon on port 5432 without confirmation', () => {
    expect(() => assertBootstrapDatabaseAllowed(persistent, undefined)).toThrow(
      /PLATFORM_ADMIN_BOOTSTRAP_CONFIRM=salon/,
    );
  });

  it('allows persistent salon only when the operator confirms that database', () => {
    expect(() => assertBootstrapDatabaseAllowed(persistent, 'salon')).not.toThrow();
  });

  it('allows a disposable database without the persistent confirmation', () => {
    expect(() =>
      assertBootstrapDatabaseAllowed(
        'postgresql://salon:placeholder@127.0.0.1:55442/salon_bootstrap_cmd_20261011?schema=public',
        undefined,
      ),
    ).not.toThrow();
    expect(() =>
      assertBootstrapDatabaseAllowed('postgresql://salon:placeholder@127.0.0.1:55439/salon', undefined),
    ).not.toThrow();
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
