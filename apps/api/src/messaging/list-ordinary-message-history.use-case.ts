import { Injectable } from '@nestjs/common';
import {
  maskCustomerPhone,
  ValidationError,
  type AuthenticatedPrincipal,
  type MessageDeliveryMode,
  type MessageRequestStatus,
} from '@salon/shared';
import {
  decodeCursor,
  encodeCursor,
  parseCursorInstant,
  parseCursorUuid,
  toListPage,
} from '../infrastructure/http/list-page';
import { MESSAGE_LIST_LIMIT, MessageRepository } from './message.repository';

export type OrdinaryMessageHistoryItem = {
  id: string;
  customerId: string;
  customerDisplayName: string;
  destinationHint: string;
  /** Durable MessageRequest.status; DISPATCHED is processing, not sent. */
  requestStatus: MessageRequestStatus;
  /** Salon-facing bucket derived from request + delivery facts. */
  displayStatus: 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
  deliveryStatus: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | null;
  deliveryMode: MessageDeliveryMode | null;
  opportunityType: string | null;
  requestedAt: string;
  submittedAt: string | null;
  /**
   * SENT means a recorded send (manual mark or provider acceptance path),
   * not confirmed delivery or read.
   */
  sentMeans: 'RECORDED_SEND_NOT_DELIVERY';
};

@Injectable()
export class ListOrdinaryMessageHistoryUseCase {
  constructor(private readonly messages: MessageRepository) {}

  async execute(principal: AuthenticatedPrincipal, cursorValue?: string) {
    const cursorParts = decodeCursor(cursorValue, 2);
    const cursor = cursorParts
      ? {
          requestedAt: parseCursorInstant(cursorParts[0]!),
          id: parseCursorUuid(cursorParts[1]!),
        }
      : undefined;
    const rows = await this.messages.listOrdinaryHistory(principal.tenantId, cursor);
    const page = toListPage(rows, MESSAGE_LIST_LIMIT, (row) =>
      encodeCursor([row.requestedAt.toISOString(), row.id]),
    );
    return {
      consistency: 'LIVE_READ' as const,
      explanation:
        'تاریخچهٔ پیام‌های عادی همین سالن (بدون VIP). وضعیت‌ها از MessageRequest و MessageDelivery خوانده می‌شوند؛ «ارسال شد» به‌معنای تحویل یا خوانده‌شدن نیست.',
      items: page.items.map(toHistoryItem),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

function toHistoryItem(row: {
  id: string;
  customerId: string | null;
  opportunityType: string | null;
  status: MessageRequestStatus;
  requestedAt: Date;
  recipientPhoneNumber: string | null;
  customer: { firstName: string; lastName: string } | null;
  deliveries: Array<{
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    mode: MessageDeliveryMode;
    submittedAt: Date | null;
  }>;
}): OrdinaryMessageHistoryItem {
  if (!row.customerId || !row.customer) {
    throw new ValidationError('Ordinary message history row is missing its customer');
  }
  const delivery = row.deliveries[0];
  return {
    id: row.id,
    customerId: row.customerId,
    customerDisplayName: `${row.customer.firstName} ${row.customer.lastName}`.trim(),
    destinationHint: maskCustomerPhone(row.recipientPhoneNumber ?? ''),
    requestStatus: row.status,
    displayStatus: toDisplayStatus(row.status, delivery?.status ?? null),
    deliveryStatus: delivery?.status ?? null,
    deliveryMode: delivery?.mode ?? null,
    opportunityType: row.opportunityType,
    requestedAt: row.requestedAt.toISOString(),
    submittedAt: delivery?.submittedAt?.toISOString() ?? null,
    sentMeans: 'RECORDED_SEND_NOT_DELIVERY',
  };
}

export function toDisplayStatus(
  requestStatus: MessageRequestStatus,
  deliveryStatus: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | null,
): OrdinaryMessageHistoryItem['displayStatus'] {
  if (requestStatus === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (requestStatus === 'FAILED' || deliveryStatus === 'FAILED') {
    return 'FAILED';
  }
  if (requestStatus === 'SENT' || deliveryStatus === 'SENT') {
    return 'SENT';
  }
  if (requestStatus === 'DISPATCHED' || deliveryStatus === 'PROCESSING' || deliveryStatus === 'PENDING') {
    return 'PROCESSING';
  }
  return 'QUEUED';
}
