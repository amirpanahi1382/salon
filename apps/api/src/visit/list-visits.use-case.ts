import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { toListPage } from '../infrastructure/http/list-page';
import type { ListVisitsQueryDto } from './visit.dto';
import { VisitRepository, VISIT_LIST_LIMIT } from './visit.repository';
import { toVisitListItem } from './visit.mapper';
import { parseVisitDateFilter, parseVisitInstantRange } from './visited-at';

@Injectable()
export class ListVisitsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, query: ListVisitsQueryDto) {
    let customerId: string | undefined;
    if (query.customerId) {
      const customer = await this.customers.findById(principal.tenantId, query.customerId);
      if (!customer) {
        throw new NotFoundError('Customer not found');
      }
      customerId = customer.id;
    }

    let from: Date | undefined;
    let to: Date | undefined;
    if (query.date) {
      ({ from, to } = parseVisitDateFilter(query.date));
    } else if (query.from || query.to) {
      if (!query.from || !query.to) {
        throw new ValidationError('from and to are both required when filtering by a time window');
      }
      ({ from, to } = parseVisitInstantRange(query.from, query.to));
    }

    const limit = query.limit ?? VISIT_LIST_LIMIT;
    const rows = await this.visits.listForSalon(principal.tenantId, {
      customerId,
      from,
      to,
      limit,
    });
    return toListPage(rows.map(toVisitListItem), limit);
  }
}
