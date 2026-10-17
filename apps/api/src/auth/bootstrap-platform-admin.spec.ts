import { establishPlatformAdmin } from './establish-platform-admin';

const { assertBootstrapDatabaseAllowed } = require('../../scripts/bootstrap-platform-admin.cjs') as {
  assertBootstrapDatabaseAllowed: (databaseUrl: string) => void;
};
import { listenApi } from './listen-api';
import { PlatformAdminLoginUseCase } from './platform-admin-login.use-case';

describe('establishPlatformAdmin', () => {
  const hashPassword = jest.fn(async (password: string) => `hash:${password}`);
  const createId = () => '11111111-1111-4111-8111-111111111111';
  const databaseUrl = 'postgresql://salon:placeholder@127.0.0.1:55442/salon_phone_first_spec';
  const expected = {
    databaseName: 'salon_phone_first_spec',
    systemIdentifier: '7697600000000000001',
    databaseComment: 'salon-new-empty-database',
  };

  beforeEach(() => {
    hashPassword.mockClear();
  });

  function prismaMock(count = 0) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      platformAdmin: {
        count: jest.fn().mockResolvedValue(count),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return {
      platformAdmin: { count: jest.fn().mockResolvedValue(count) },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          name: 'salon_phone_first_spec',
          system_identifier: '7697600000000000001',
          comment: 'salon-new-empty-database',
        },
      ]),
      $transaction: jest.fn(async (run: (client: typeof tx) => Promise<void>) => run(tx)),
      tx,
    };
  }

  function otp(verified = true) {
    return {
      send: jest.fn(async () => ({ requestId: 'otp-test', ttlSeconds: 120 })),
      verify: jest.fn(async () => verified),
    };
  }

  it('sends a verification and inserts nothing when the code is omitted', async () => {
    const prisma = prismaMock();
    const provider = otp();
    const result = await establishPlatformAdmin({
      prisma: prisma as never,
      databaseUrl,
      expected,
      phone: '09120000000',
      password: 'development-admin-pass',
      otpCode: undefined,
      otp: provider,
      hashPassword,
      createId,
    });
    expect(result).toEqual({ outcome: 'verification_sent' });
    expect(provider.send).toHaveBeenCalledWith('09120000000');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('inserts nothing when verification fails', async () => {
    const prisma = prismaMock();
    const provider = otp(false);
    await expect(
      establishPlatformAdmin({
        prisma: prisma as never,
        databaseUrl,
        expected,
        phone: '09120000000',
        password: 'development-admin-pass',
        otpCode: '000000',
        otp: provider,
        hashPassword,
        createId,
      }),
    ).rejects.toThrow('Platform admin verification failed');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('creates the first admin after a verified code', async () => {
    const prisma = prismaMock();
    const result = await establishPlatformAdmin({
      prisma: prisma as never,
      databaseUrl,
      expected,
      phone: ' 09120000000 ',
      password: 'development-admin-pass',
      otpCode: '123456',
      otp: otp(),
      hashPassword,
      createId,
    });
    expect(result).toEqual({ outcome: 'established' });
    expect(prisma.tx.platformAdmin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '09120000000',
        email: null,
        passwordHash: 'hash:development-admin-pass',
        name: 'Platform Admin',
      }),
    });
  });

  it('does not change an admin that already exists', async () => {
    const prisma = prismaMock(1);
    const provider = otp();
    await expect(
      establishPlatformAdmin({
        prisma: prisma as never,
        databaseUrl,
        expected,
        phone: '09120000000',
        password: 'development-admin-pass',
        otpCode: '123456',
        otp: provider,
        hashPassword,
        createId,
      }),
    ).rejects.toThrow(/already exists/);
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.verify).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.tx.platformAdmin.create).not.toHaveBeenCalled();
  });

  it('fails before a message when the target proof is missing or does not match', async () => {
    const prisma = prismaMock();
    const provider = otp();
    await expect(
      establishPlatformAdmin({
        prisma: prisma as never,
        databaseUrl,
        expected: undefined,
        phone: '09120000000',
        password: 'development-admin-pass',
        otpCode: undefined,
        otp: provider,
        hashPassword,
        createId,
      }),
    ).rejects.toThrow(/target proof is incomplete/);
    await expect(
      establishPlatformAdmin({
        prisma: prisma as never,
        databaseUrl,
        expected: { ...expected, systemIdentifier: '1' },
        phone: '09120000000',
        password: 'development-admin-pass',
        otpCode: '123456',
        otp: provider,
        hashPassword,
        createId,
      }),
    ).rejects.toThrow(/does not match/);
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.verify).not.toHaveBeenCalled();
    expect(prisma.platformAdmin.count).not.toHaveBeenCalled();
    expect(prisma.tx.platformAdmin.create).not.toHaveBeenCalled();
  });

  it('fails before a message when the live identity cannot be read', async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValue([{ name: 'salon_phone_first_spec', system_identifier: null, comment: null }]);
    const provider = otp();
    await expect(
      establishPlatformAdmin({
        prisma: prisma as never,
        databaseUrl,
        expected,
        phone: '09120000000',
        password: 'development-admin-pass',
        otpCode: '123456',
        otp: provider,
        hashPassword,
        createId,
      }),
    ).rejects.toThrow(/could not be read/);
    expect(provider.send).not.toHaveBeenCalled();
    expect(prisma.tx.platformAdmin.create).not.toHaveBeenCalled();
  });

  it('refuses a phone that is not an Iranian mobile number', async () => {
    const prisma = prismaMock();
    await expect(
      establishPlatformAdmin({
        prisma: prisma as never,
        databaseUrl,
        expected,
        phone: '12345',
        password: 'development-admin-pass',
        otpCode: undefined,
        otp: otp(),
        hashPassword,
        createId,
      }),
    ).rejects.toThrow(/Iranian mobile/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('API startup leaves existing platform admin credentials unchanged', () => {
  const previousEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const previousPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  const previousPhone = process.env.PLATFORM_ADMIN_PHONE;
  const previousPort = process.env.API_PORT;

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAIL = 'admin@salon.local';
    process.env.PLATFORM_ADMIN_PASSWORD = 'development-admin-pass';
    process.env.PLATFORM_ADMIN_PHONE = '09120000000';
    process.env.API_PORT = '3000';
  });

  afterEach(() => {
    restoreEnv('PLATFORM_ADMIN_EMAIL', previousEmail);
    restoreEnv('PLATFORM_ADMIN_PASSWORD', previousPassword);
    restoreEnv('PLATFORM_ADMIN_PHONE', previousPhone);
    restoreEnv('API_PORT', previousPort);
  });

  function adminDb() {
    return {
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
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
    expect(admin.count).not.toHaveBeenCalled();
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
    expect(admin.count).not.toHaveBeenCalled();
  });
});

describe('explicit bootstrap database guard', () => {
  const persistent = 'postgresql://salon:placeholder@127.0.0.1:5432/salon?schema=public';

  it('refuses database salon on every port', () => {
    expect(() => assertBootstrapDatabaseAllowed(persistent)).toThrow(/salon or salon_preview/);
    expect(() =>
      assertBootstrapDatabaseAllowed('postgresql://salon:placeholder@127.0.0.1:55439/salon'),
    ).toThrow(/salon or salon_preview/);
  });

  it('refuses salon_preview and ignores the old confirm value', () => {
    expect(() =>
      assertBootstrapDatabaseAllowed(
        'postgresql://salon:placeholder@127.0.0.1:15442/salon_preview',
      ),
    ).toThrow(/salon or salon_preview/);
  });

  it('allows a disposable database', () => {
    expect(() =>
      assertBootstrapDatabaseAllowed(
        'postgresql://salon:placeholder@127.0.0.1:55442/salon_bootstrap_cmd_20261011?schema=public',
      ),
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
