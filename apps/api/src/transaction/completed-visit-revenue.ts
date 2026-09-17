import { addMoney, parseMoneyString } from '@salon/shared';
import type { Prisma } from '@salon/database';

type LedgerDb = {
  ledgerTransaction: {
    findMany(args: {
      where: {
        salonId: string;
        customerId: string;
        visitId: { in: string[] };
        status: 'COMPLETED';
      };
      select: { visitId: true; amount: true };
    }): Promise<Array<{ visitId: string | null; amount: Prisma.Decimal }>>;
  };
};

export async function completedRevenueByVisitIds(
  db: LedgerDb,
  tenantId: string,
  customerId: string,
  visitIds: string[],
): Promise<Map<string, bigint>> {
  const amounts = new Map<string, bigint>();
  if (visitIds.length === 0) {
    return amounts;
  }
  const rows = await db.ledgerTransaction.findMany({
    where: {
      salonId: tenantId,
      customerId,
      visitId: { in: visitIds },
      status: 'COMPLETED',
    },
    select: { visitId: true, amount: true },
  });
  for (const row of rows) {
    if (!row.visitId) {
      continue;
    }
    const next = parseMoneyString(row.amount.toFixed(2));
    amounts.set(row.visitId, addMoney([amounts.get(row.visitId) ?? 0n, next]));
  }
  return amounts;
}
