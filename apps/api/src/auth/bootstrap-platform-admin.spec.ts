import { bootstrapPlatformAdmin } from './bootstrap-platform-admin';

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

  it('updates an existing admin instead of inserting a duplicate', async () => {
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
