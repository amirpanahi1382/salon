import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { toMessageResponse, type MessageRequestRow } from './message.mapper';
import { ListCustomerMessagesQueryDto } from './message.dto';
import { MESSAGE_LIST_LIMIT, MessageRepository } from './message.repository';

@Injectable()
export class GetMessageUseCase {
  constructor(private readonly messages: MessageRepository) {}

  async execute(principal: AuthenticatedPrincipal, id: string) {
    const byRequest = await this.messages.findRequestById(principal.tenantId, id);
    const row = byRequest ?? (await this.messages.findRequestByDeliveryId(principal.tenantId, id));
    if (!row) {
      throw new NotFoundError('Message not found');
    }
    return toMessageResponse(row as MessageRequestRow);
  }
}

@Injectable()
export class ListCustomerMessagesUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly messages: MessageRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    query: ListCustomerMessagesQueryDto,
  ) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    const cursorParts = decodeCursor(query.cursor, 2);
    const cursor = cursorParts
      ? { createdAt: parseCursorDate(cursorParts[0] ?? ''), id: cursorParts[1] ?? '' }
      : undefined;
    const rows = (await this.messages.listForCustomer(
      principal.tenantId,
      customer.id,
      cursor,
    )) as MessageRequestRow[];
    const page = toListPage(rows, MESSAGE_LIST_LIMIT, (row) =>
      encodeCursor([row.requestedAt.toISOString(), row.id]),
    );
    return {
      items: page.items.map(toMessageResponse),
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
