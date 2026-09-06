import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { VisitRepository, VISIT_LIST_LIMIT } from './visit.repository';
import { toVisitResponse } from './visit.mapper';
import { parseVisitCursor } from './list-visits.use-case';

@Injectable()
export class ListCustomerVisitsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string, cursor?: string) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const rows = await this.visits.listForCustomer(
      principal.tenantId,
      customer.id,
      parseVisitCursor(cursor),
    );
    return toListPage(rows.map(toVisitResponse), VISIT_LIST_LIMIT, (item) =>
      encodeCursor([item.visitedAt, item.createdAt, item.id]),
    );
  }
}
