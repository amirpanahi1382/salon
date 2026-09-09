import type { OpportunityType } from '@salon/shared';
import { maskCustomerPhone, type MessageFailureCode } from '@salon/shared';
import type { MessageDeliveryResponseDto } from './message.dto';

export const MESSAGE_SELECT = {
  id: true,
  customerId: true,
  actionId: true,
  provider: true,
  channel: true,
  status: true,
  body: true,
  failureCode: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  failedAt: true,
  action: { select: { opportunityType: true } },
  customer: { select: { phoneNumber: true } },
} as const;

export type MessageRow = {
  id: string;
  customerId: string;
  actionId: string;
  provider: 'BALE_SAFIR';
  channel: 'TEXT';
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  body: string;
  failureCode: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  failedAt: Date | null;
  action: { opportunityType: OpportunityType };
  customer: { phoneNumber: string };
};

export function toMessageResponse(row: MessageRow): MessageDeliveryResponseDto {
  return {
    id: row.id,
    customerId: row.customerId,
    actionId: row.actionId,
    opportunityType: row.action.opportunityType,
    provider: row.provider,
    channel: row.channel,
    status: row.status,
    body: row.body,
    destinationHint: maskCustomerPhone(row.customer.phoneNumber),
    failureCode: (row.failureCode as MessageFailureCode | null) ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
  };
}
