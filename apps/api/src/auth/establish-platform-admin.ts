import type { PrismaClient } from '@salon/database';
import type { OtpProvider } from './otp-provider';

const IRANIAN_MOBILE = /^09\d{9}$/;
const DENIED_DATABASES = new Set(['salon', 'salon_preview']);

export type DatabaseTargetProof = {
  databaseName: string;
  systemIdentifier: string;
  databaseComment: string;
};

export type PlatformAdminEstablishResult =
  | { outcome: 'verification_sent' }
  | { outcome: 'established' };

/**
 * Operator command for the first platform admin in a new empty database.
 * The phone comes from the operator environment. It is not hard-coded.
 * The command reads the live database name, system identifier, and comment
 * and compares them to the operator-supplied proof before any SMS or write.
 * A failed verification inserts nothing. An existing admin is not updated.
 * API startup must not call this.
 */
export async function establishPlatformAdmin(input: {
  prisma: PrismaClient;
  databaseUrl: string;
  expected: DatabaseTargetProof | undefined;
  phone: string | undefined;
  password: string | undefined;
  otpCode: string | undefined;
  otp: OtpProvider;
  hashPassword: (password: string) => Promise<string>;
  createId: () => string;
}): Promise<PlatformAdminEstablishResult> {
  const expectedName = assertTargetProofShape(input.databaseUrl, input.expected);
  await assertConnectedDatabaseTarget(input.prisma, {
    databaseName: expectedName,
    systemIdentifier: input.expected!.systemIdentifier.trim(),
    databaseComment: input.expected!.databaseComment,
  });

  const phone = input.phone?.trim();
  const password = input.password;
  if (!phone || !password) {
    throw new Error('PLATFORM_ADMIN_PHONE and PLATFORM_ADMIN_PASSWORD must both be set');
  }
  if (!IRANIAN_MOBILE.test(phone)) {
    throw new Error('PLATFORM_ADMIN_PHONE must be an Iranian mobile number');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be 12 to 128 characters');
  }

  const code = input.otpCode?.trim();
  const already = await input.prisma.platformAdmin.count();
  if (already > 0) {
    throw new Error('A platform admin already exists. This command does not change that account.');
  }
  if (!code) {
    await input.otp.send(phone);
    return { outcome: 'verification_sent' };
  }

  const verified = await input.otp.verify(phone, code);
  if (!verified) {
    throw new Error('Platform admin verification failed');
  }

  const passwordHash = await input.hashPassword(password);
  try {
    await input.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform-admin-establish'))`;
      const existing = await tx.platformAdmin.count();
      if (existing > 0) {
        throw new Error('A platform admin already exists. This command does not change that account.');
      }
      await tx.platformAdmin.create({
        data: {
          id: input.createId(),
          phone,
          email: null,
          passwordHash,
          name: 'Platform Admin',
          updatedAt: new Date(),
        },
      });
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('phone_identity_cross_role')) {
      throw new Error('This mobile number cannot be used.');
    }
    if (isUniquePhone(error)) {
      throw new Error('This mobile number cannot be used.');
    }
    throw error;
  }
  return { outcome: 'established' };
}

export function assertEstablishDatabaseAllowed(databaseUrl: string): string {
  return databaseNameFromUrl(databaseUrl);
}

function assertTargetProofShape(
  databaseUrl: string,
  expected: DatabaseTargetProof | undefined,
): string {
  const databaseName = databaseNameFromUrl(databaseUrl);
  if (
    !expected?.databaseName?.trim() ||
    !expected.systemIdentifier?.trim() ||
    !expected.databaseComment?.trim()
  ) {
    throw new Error('Platform admin target proof is incomplete');
  }
  if (expected.databaseName.trim() !== databaseName) {
    throw new Error('Platform admin target proof does not match the connected database');
  }
  return databaseName;
}

async function assertConnectedDatabaseTarget(
  prisma: PrismaClient,
  expected: DatabaseTargetProof,
): Promise<void> {
  let row: { name: string | null; system_identifier: string | null; comment: string | null } | undefined;
  try {
    let rows: Array<{ name: string | null; system_identifier: string | null; comment: string | null }>;
    try {
      rows = await prisma.$queryRaw<
        Array<{ name: string | null; system_identifier: string | null; comment: string | null }>
      >`
        SELECT database_name AS name,
               system_identifier,
               database_comment AS comment
        FROM canonical_database_identity()
      `;
    } catch {
      // Operator recovery on a database without the scoped function still uses
      // the superuser catalog call. The API role cannot take this path.
      rows = await prisma.$queryRaw<
        Array<{ name: string | null; system_identifier: string | null; comment: string | null }>
      >`
        SELECT current_database() AS name,
               (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
               shobj_description(
                 (SELECT oid FROM pg_database WHERE datname = current_database()),
                 'pg_database'
               ) AS comment
      `;
    }
    row = rows[0];
  } catch {
    throw new Error('The connected database identity could not be read');
  }
  if (!row?.name || !row.system_identifier || !row.comment) {
    throw new Error('The connected database identity could not be read');
  }
  if (
    row.name !== expected.databaseName ||
    row.system_identifier !== expected.systemIdentifier ||
    row.comment !== expected.databaseComment
  ) {
    throw new Error('Platform admin target proof does not match the connected database');
  }
}

function databaseNameFromUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL could not be read for the bootstrap target check');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL could not be read for the bootstrap target check');
  }
  if (DENIED_DATABASES.has(database)) {
    throw new Error(
      'Refusing to establish a platform admin in database salon or salon_preview',
    );
  }
  return database;
}

function isUniquePhone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  if (error.code !== 'P2002') {
    return false;
  }
  const meta = 'meta' in error ? error.meta : undefined;
  const target =
    typeof meta === 'object' && meta !== null && 'target' in meta ? meta.target : undefined;
  return String(target ?? '').includes('phone');
}
