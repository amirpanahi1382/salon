import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import { parseVisitDateFilter, parseVisitInstantRange } from '../visit/visited-at';
import type { ListTransactionsQueryDto } from './transaction.dto';
import { toTransactionResponse } from './transaction.mapper';
import { TRANSACTION_LIST_LIMIT, TransactionRepository } from './transaction.repository';

@Injectable()
export class ListTransactionsUseCase {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, query: ListTransactionsQueryDto) {
    if (query.customerId) {
      const customer = await this.customers.findById(principal.tenantId, query.customerId);
      if (!customer) {
        throw new NotFoundError('Customer not found');
      }
    }
    let from: Date | undefined;
    let to: Date | undefined;
    if (query.date) {
      const day = parseVisitDateFilter(query.date);
      from = day.from;
      to = day.to;
    } else if (query.from || query.to) {
      if (!query.from || !query.to) {
        throw new ValidationError('from and to must be provided together');
      }
      const range = parseVisitInstantRange(query.from, query.to);
      from = range.from;
      to = range.to;
    }
    const parts = decodeCursor(query.cursor, 2);
    const cursor = parts ? { occurredAt: parseCursorInstant(parts[0]!), id: parseCursorUuid(parts[1]!) } : undefined;
    const limit = query.limit ?? TRANSACTION_LIST_LIMIT;
    const rows = await this.transactions.list(principal.tenantId, {
      customerId: query.customerId,
      status: query.status,
      from,
      to,
      limit,
      cursor,
    });
    const page = toListPage(rows, limit, (row) => encodeCursor([row.occurredAt.toISOString(), row.id]));
    return {
      items: page.items.map(toTransactionResponse),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
