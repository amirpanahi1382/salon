import {
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  COMMITMENT_BACKED_ASSOCIATION_RULE,
  formatMoneyString,
} from '@salon/shared';
import type {
  CommitmentBackedReturnDto,
  ReturnCommitmentResponseDto,
  ReturnCommitmentSummaryDto,
  UpcomingReturnCommitmentItemDto,
} from './return-commitment.dto';

export const RETURN_COMMITMENT_SELECT = {
  id: true,
  customerId: true,
  sourceMessageRequestId: true,
  sourceMessageDeliveryId: true,
  expectedAt: true,
  actualVisitId: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ReturnCommitmentRow = {
  id: string;
  customerId: string;
  sourceMessageRequestId: string;
  sourceMessageDeliveryId: string;
  expectedAt: Date;
  actualVisitId: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toAssociatedRevenue(amountMinor: bigint | undefined): {
  recorded: boolean;
  currency: 'IRR';
  amount: string | null;
} {
  if (amountMinor == null) {
    return { recorded: false, currency: 'IRR', amount: null };
  }
  return { recorded: true, currency: 'IRR', amount: formatMoneyString(amountMinor) };
}

export function toCommitmentBackedReturn(
  visit: { id: string; visitedAt: Date },
  amountMinor: bigint | undefined,
): CommitmentBackedReturnDto {
  return {
    associationKind: COMMITMENT_BACKED_ASSOCIATION_KIND,
    associationRule: COMMITMENT_BACKED_ASSOCIATION_RULE,
    actualVisit: {
      visitId: visit.id,
      visitedAt: visit.visitedAt.toISOString(),
    },
    associatedRevenue: toAssociatedRevenue(amountMinor),
  };
}

export function toReturnCommitmentResponse(
  row: ReturnCommitmentRow,
  commitmentBackedReturn: CommitmentBackedReturnDto | null = null,
): ReturnCommitmentResponseDto {
  return {
    id: row.id,
    customerId: row.customerId,
    sourceMessage: {
      requestId: row.sourceMessageRequestId,
      deliveryId: row.sourceMessageDeliveryId,
    },
    expectedAt: row.expectedAt.toISOString(),
    actualVisitId: row.actualVisitId,
    commitmentBackedReturn,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toReturnCommitmentSummary(row: ReturnCommitmentRow): ReturnCommitmentSummaryDto {
  return {
    id: row.id,
    expectedAt: row.expectedAt.toISOString(),
    actualVisitId: row.actualVisitId,
  };
}

export function toUpcomingReturnCommitmentItem(row: {
  id: string;
  customerId: string;
  expectedAt: Date;
  customer: { firstName: string; lastName: string };
}): UpcomingReturnCommitmentItemDto {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: `${row.customer.firstName} ${row.customer.lastName}`.trim(),
    expectedAt: row.expectedAt.toISOString(),
  };
}
