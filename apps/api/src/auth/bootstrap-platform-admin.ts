import type { PrismaClient } from '@salon/database';

export type PlatformAdminBootstrapResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'created' | 'updated'; email: string };

/**
 * Explicit development upsert. Never logs the password.
 * API startup must not call this: module init runs before the port binds.
 * Operator command: `pnpm db:bootstrap-admin` (development only; production refuses).
 */
export async function bootstrapPlatformAdmin(input: {
  prisma: PrismaClient;
  nodeEnv: string;
  email: string | undefined;
  password: string | undefined;
  hashPassword: (password: string) => Promise<string>;
  createId: () => string;
}): Promise<PlatformAdminBootstrapResult> {
  if (input.nodeEnv === 'production') {
    return {
      outcome: 'skipped',
      reason: 'Platform admin bootstrap is not allowed when NODE_ENV=production',
    };
  }

  const email = input.email?.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) {
    return {
      outcome: 'skipped',
      reason:
        'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must both be set for development bootstrap',
    };
  }

  const passwordHash = await input.hashPassword(password);
  const existing = await input.prisma.platformAdmin.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    await input.prisma.platformAdmin.update({
      where: { id: existing.id },
      data: { passwordHash, status: 'ACTIVE', updatedAt: new Date() },
    });
    return { outcome: 'updated', email };
  }

  await input.prisma.platformAdmin.create({
    data: {
      id: input.createId(),
      email,
      passwordHash,
      name: 'Platform Admin',
      updatedAt: new Date(),
    },
  });
  return { outcome: 'created', email };
}
