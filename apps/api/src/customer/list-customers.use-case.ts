import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository, CUSTOMER_LIST_LIMIT } from './customer.repository';
import { toCustomerResponse } from './customer.mapper';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';

@Injectable()
export class ListCustomersUseCase {
  constructor(private readonly customers: CustomerRepository) {}

  async execute(principal: AuthenticatedPrincipal, search?: string, cursor?: string) {
    const parts = decodeCursor(cursor, 2);
    const rows = await this.customers.list(
      principal.tenantId,
      search,
      parts ? { createdAt: parseCursorInstant(parts[0]!), id: parseCursorUuid(parts[1]!) } : undefined,
    );
    return toListPage(rows.map(toCustomerResponse), CUSTOMER_LIST_LIMIT, (item) =>
      encodeCursor([item.createdAt, item.id]),
    );
  }
}
