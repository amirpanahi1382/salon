import { Prisma } from '@salon/database';
import { formatMoneyString, parseMoneyString } from '@salon/shared';
import type { TransactionItemResponseDto, TransactionResponseDto } from './transaction.dto';

export const TRANSACTION_INCLUDE = {
  items: {
    include: { service: { select: { name: true } } },
    orderBy: { id: 'asc' as const },
  },
} as const;

function decimalToMoney(value: Prisma.Decimal): string {
  return formatMoneyString(parseMoneyString(value.toFixed(2)));
}

export function toTransactionResponse(row: {
  id: string;
  customerId: string;
  visitId: string | null;
  occurredAt: Date;
  amount: Prisma.Decimal;
  currency: string;
  status: 'COMPLETED' | 'VOIDED';
  createdAt: Date;
  items: Array<{
    id: string;
    serviceId: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    service: { name: string };
  }>;
}): TransactionResponseDto {
  return {
    id: row.id,
    customerId: row.customerId,
    visitId: row.visitId,
    occurredAt: row.occurredAt.toISOString(),
    amount: decimalToMoney(row.amount),
    currency: row.currency,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map(toItemResponse),
  };
}

function toItemResponse(item: {
  id: string;
  serviceId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  service: { name: string };
}): TransactionItemResponseDto {
  return {
    id: item.id,
    serviceId: item.serviceId,
    serviceName: item.service.name,
    quantity: item.quantity,
    unitPrice: decimalToMoney(item.unitPrice),
    totalAmount: decimalToMoney(item.totalAmount),
  };
}
