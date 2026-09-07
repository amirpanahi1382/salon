import type { VisitHistoryItemDto, VisitListItemDto, VisitResponseDto } from './visit.dto';
import { saleFacts, type VisitSaleRow } from './visit-sale';

export const VISIT_SELECT = {
  id: true,
  customerId: true,
  visitedAt: true,
  createdAt: true,
} as const;

export function toVisitResponse(visit: {
  id: string;
  customerId: string;
  visitedAt: Date;
  createdAt: Date;
}): VisitResponseDto {
  return {
    id: visit.id,
    customerId: visit.customerId,
    visitedAt: visit.visitedAt.toISOString(),
    createdAt: visit.createdAt.toISOString(),
  };
}

export function toVisitHistoryItem(visit: {
  id: string;
  customerId: string;
  visitedAt: Date;
  createdAt: Date;
  transactions: VisitSaleRow[];
}): VisitHistoryItemDto {
  const sale = saleFacts(visit.transactions);
  return {
    ...toVisitResponse(visit),
    serviceName: sale.serviceName,
    amountReceived: sale.amountReceived,
  };
}

export function toVisitListItem(visit: {
  id: string;
  customerId: string;
  visitedAt: Date;
  createdAt: Date;
  customer: { firstName: string; lastName: string };
  transactions: VisitSaleRow[];
}): VisitListItemDto {
  return {
    ...toVisitHistoryItem(visit),
    firstName: visit.customer.firstName,
    lastName: visit.customer.lastName,
  };
}
