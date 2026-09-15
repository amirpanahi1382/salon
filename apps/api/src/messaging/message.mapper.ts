import {
  maskCustomerPhone,
  salonMessageStatus,
  type MessageDeliveryMode,
  type MessageFailureCode,
  type MessageProvider,
  type MessageRequestStatus,
  type OpportunityType,
} from '@salon/shared';
import type { ManualOutreachItemDto, MessageRequestResponseDto } from './message.dto';

export const MESSAGE_REQUEST_SELECT = {
  id: true,
  customerId: true,
  actionId: true,
  opportunityType: true,
  messageText: true,
  status: true,
  createdByUserId: true,
  requestedAt: true,
  createdAt: true,
  updatedAt: true,
  recipientPhoneNumber: true,
  customer: { select: { phoneNumber: true } },
  deliveries: {
    select: {
      id: true,
      mode: true,
      provider: true,
      status: true,
      failureCode: true,
      submittedAt: true,
      failedAt: true,
    },
    take: 1,
  },
} as const;

export type MessageRequestRow = {
  id: string;
  customerId: string | null;
  actionId: string | null;
  opportunityType: OpportunityType | null;
  messageText: string;
  status: MessageRequestStatus;
  createdByUserId: string;
  requestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  recipientPhoneNumber: string | null;
  customer: { phoneNumber: string } | null;
  deliveries: Array<{
    id: string;
    mode: MessageDeliveryMode;
    provider: MessageProvider | null;
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    failureCode: string | null;
    submittedAt: Date | null;
    failedAt: Date | null;
  }>;
};

export function toMessageResponse(row: MessageRequestRow): MessageRequestResponseDto {
  const delivery = row.deliveries[0];
  return {
    id: row.id,
    customerId: row.customerId,
    actionId: row.actionId,
    opportunityType: row.opportunityType,
    channel: 'TEXT',
    status: salonMessageStatus(row.status),
    mode: delivery?.mode ?? null,
    provider: delivery?.provider ?? null,
    body: row.messageText,
    destinationHint: maskCustomerPhone(
      row.customer?.phoneNumber ?? row.recipientPhoneNumber ?? '',
    ),
    failureCode: (delivery?.failureCode as MessageFailureCode | null) ?? null,
    createdBy: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    submittedAt: delivery?.submittedAt?.toISOString() ?? null,
    failedAt: delivery?.failedAt?.toISOString() ?? null,
  };
}

export function toManualOutreachItem(row: {
  id: string;
  customerId: string;
  status: MessageRequestStatus;
  requestedAt: Date;
  updatedAt: Date;
  customer: { firstName: string; lastName: string };
}): ManualOutreachItemDto {
  return {
    customerId: row.customerId,
    customerName: `${row.customer.firstName} ${row.customer.lastName}`.trim(),
    messageRequestId: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
