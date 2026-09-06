import { Prisma } from '@salon/database';
import { formatMoneyString, parseMoneyString } from '@salon/shared';

export const VISIT_SALE_SELECT = {
  amount: true,
  status: true,
  createdAt: true,
  id: true,
  items: {
    select: { service: { select: { name: true } } },
    orderBy: { id: 'asc' as const },
    take: 1,
  },
} as const;

export type VisitSaleRow = {
  id: string;
  amount: Prisma.Decimal;
  status: 'COMPLETED' | 'VOIDED';
  createdAt: Date;
  items: Array<{ service: { name: string } }>;
};

export function saleFacts(transactions: VisitSaleRow[]): {
  serviceName: string | null;
  amountReceived: string | null;
} {
  if (transactions.length === 0) {
    return { serviceName: null, amountReceived: null };
  }
  const completed = transactions.find((row) => row.status === 'COMPLETED');
  const chosen = completed ?? transactions[0]!;
  const serviceName = chosen.items[0]?.service.name ?? null;
  const amountReceived = completed ? decimalToMoney(completed.amount) : null;
  return { serviceName, amountReceived };
}

export function decimalToMoney(value: Prisma.Decimal): string {
  return formatMoneyString(parseMoneyString(value.toFixed(2)));
}
