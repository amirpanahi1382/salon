import type { Prisma } from '@salon/database';

/** Serializes user-administration changes for one salon so last-OWNER checks stay correct. */
export async function lockSalonForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM salons WHERE id = ${tenantId}::uuid FOR UPDATE
  `;
}
