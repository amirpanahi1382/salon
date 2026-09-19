import { getBaleSafirSettings } from '@salon/config';
import {
  type MessageDeliveryMode,
  type MessageFailureCode,
  type MessageRequestStatus,
  type OpportunityType,
} from '@salon/shared';
import type { AppConfig } from '@salon/config';
import type { ReturnCommitmentSummaryDto } from '../return-commitment/return-commitment.dto';
import type { AdminMessageQueueItemDto } from './admin-message.dto';

export const ADMIN_MESSAGE_SELECT = {
  id: true,
  salonId: true,
  customerId: true,
  opportunityType: true,
  messageText: true,
  requestedAt: true,
  messageBusinessDate: true,
  status: true,
  vipRequestId: true,
  recipientDisplayName: true,
  recipientPhoneNumber: true,
  salon: { select: { name: true } },
  customer: { select: { firstName: true, lastName: true, phoneNumber: true } },
  deliveries: {
    select: {
      id: true,
      mode: true,
      status: true,
      failureCode: true,
      attempts: true,
      submittedAt: true,
      failedAt: true,
    },
    take: 1,
  },
} as const;

export type AdminMessageRow = {
  id: string;
  salonId: string;
  customerId: string | null;
  opportunityType: OpportunityType | null;
  messageText: string;
  requestedAt: Date;
  messageBusinessDate: Date;
  status: MessageRequestStatus;
  vipRequestId: string | null;
  recipientDisplayName: string | null;
  recipientPhoneNumber: string | null;
  salon: { name: string };
  customer: { firstName: string; lastName: string; phoneNumber: string } | null;
  deliveries: Array<{
    id: string;
    mode: MessageDeliveryMode;
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    failureCode: string | null;
    attempts: number;
    submittedAt: Date | null;
    failedAt: Date | null;
  }>;
};

export function toAdminMessageItem(
  row: AdminMessageRow,
  config: AppConfig,
  returnCommitment: ReturnCommitmentSummaryDto | null = null,
): AdminMessageQueueItemDto {
  const delivery = row.deliveries[0];
  return {
    id: row.id,
    salonId: row.salonId,
    salonName: row.salon.name,
    customerId: row.customerId,
    customerName:
      row.customer
        ? `${row.customer.firstName} ${row.customer.lastName}`.trim()
        : (row.recipientDisplayName ?? ''),
    customerPhone: row.customer?.phoneNumber ?? row.recipientPhoneNumber ?? '',
    messageText: row.messageText,
    opportunityType: row.opportunityType,
    requestedAt: row.requestedAt.toISOString(),
    messageBusinessDate: row.messageBusinessDate.toISOString().slice(0, 10),
    status: row.status,
    mode: delivery?.mode ?? null,
    deliveryStatus: delivery?.status ?? null,
    failureCode: (delivery?.failureCode as MessageFailureCode | null) ?? null,
    attempts: delivery?.attempts ?? 0,
    submittedAt: delivery?.submittedAt?.toISOString() ?? null,
    failedAt: delivery?.failedAt?.toISOString() ?? null,
    providerReady: getBaleSafirSettings(config) !== null,
    vipRequestId: row.vipRequestId,
    returnCommitment,
  };
}
