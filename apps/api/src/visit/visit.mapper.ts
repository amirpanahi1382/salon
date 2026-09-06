import type { VisitListItemDto, VisitResponseDto } from './visit.dto';

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

export function toVisitListItem(visit: {
  id: string;
  customerId: string;
  visitedAt: Date;
  createdAt: Date;
  customer: { firstName: string; lastName: string };
}): VisitListItemDto {
  return {
    ...toVisitResponse(visit),
    firstName: visit.customer.firstName,
    lastName: visit.customer.lastName,
  };
}
