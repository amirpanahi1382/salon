import { Injectable } from '@nestjs/common';
import { messageBusinessDateValue, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { ListCustomerMessagesQueryDto } from './message.dto';
import { toManualOutreachItem } from './message.mapper';
import { MESSAGE_LIST_LIMIT, MessageRepository } from './message.repository';

@Injectable()
export class ListManualOutreachUseCase {
  constructor(private readonly messages: MessageRepository) {}

  async execute(principal: AuthenticatedPrincipal, query: ListCustomerMessagesQueryDto) {
    const cursorParts = decodeCursor(query.cursor, 2);
    const cursor = cursorParts
      ? { requestedAt: parseCursorDate(cursorParts[0] ?? ''), id: cursorParts[1] ?? '' }
      : undefined;
    const rows = await this.messages.listManualForBusinessDate(
      principal.tenantId,
      messageBusinessDateValue(new Date()),
      cursor,
    );
    const page = toListPage(rows, MESSAGE_LIST_LIMIT, (row) =>
      encodeCursor([row.requestedAt.toISOString(), row.id]),
    );
    return {
      items: page.items.flatMap((row) => {
        if (!row.customerId || !row.customer) {
          return [];
        }
        return [
          toManualOutreachItem({
            id: row.id,
            customerId: row.customerId,
            status: row.status,
            requestedAt: row.requestedAt,
            updatedAt: row.updatedAt,
            customer: row.customer,
          }),
        ];
      }),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

function parseCursorDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('Invalid cursor');
  }
  return date;
}
