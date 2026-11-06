import type { PrismaClient } from '@prisma/client';

export type CanonicalDatabaseProof = {
  databaseName: string;
  systemIdentifier: string;
  databaseComment: string;
};

type IdentityRow = {
  database_name: string | null;
  system_identifier: string | null;
  database_comment: string | null;
};

const DENIED = new Set(['salon', 'salon_preview', 'salon_opp_integrity_20261024']);

/**
 * Read only the fixed security-definer identity function. Both API and an
 * isolated maintenance process use this check before accepting canonical work.
 */
export async function assertCanonicalDatabase(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  expected: CanonicalDatabaseProof,
): Promise<void> {
  if (
    !expected.databaseName
    || !expected.systemIdentifier
    || !expected.databaseComment
    || DENIED.has(expected.databaseName)
  ) {
    throw new Error('Canonical database identity is incomplete');
  }
  let row: IdentityRow | undefined;
  try {
    const rows = await prisma.$queryRaw<IdentityRow[]>`
      SELECT database_name, system_identifier, database_comment
      FROM canonical_database_identity()
    `;
    row = rows[0];
  } catch {
    throw new Error('Canonical database identity could not be read');
  }
  if (
    !row?.database_name
    || !row.system_identifier
    || row.database_comment == null
    || DENIED.has(row.database_name)
    || row.database_name !== expected.databaseName
    || row.system_identifier !== expected.systemIdentifier
    || row.database_comment !== expected.databaseComment
  ) {
    throw new Error('Canonical database identity does not match');
  }
}
