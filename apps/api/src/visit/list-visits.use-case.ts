import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import type { ExportVisitsQueryDto, ListVisitsQueryDto } from './visit.dto';
import { VisitRepository, VISIT_LIST_LIMIT } from './visit.repository';
import { toVisitListItem } from './visit.mapper';
import { parseVisitDateFilter, parseVisitInstantRange } from './visited-at';

export async function resolveVisitListFilters(
  customers: CustomerRepository,
  tenantId: string,
  query: ListVisitsQueryDto | ExportVisitsQueryDto,
) {
  let customerId: string | undefined;
  if (query.customerId) {
    const customer = await customers.findById(tenantId, query.customerId);
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

  return { customerId, from, to };
}

@Injectable()
export class ListVisitsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, query: ListVisitsQueryDto) {
    const { customerId, from, to } = await resolveVisitListFilters(
      this.customers,
      principal.tenantId,
      query,
    );

    const limit = query.limit ?? VISIT_LIST_LIMIT;
    const rows = await this.visits.listForSalon(principal.tenantId, {
      customerId,
      from,
      to,
      limit,
      cursor: parseVisitCursor(query.cursor),
    });
    return toListPage(rows.map(toVisitListItem), limit, (item) =>
      encodeCursor([item.visitedAt, item.createdAt, item.id]),
    );
  }
}

export function parseVisitCursor(cursor?: string) {
  const parts = decodeCursor(cursor, 3);
  if (!parts) {
    return undefined;
  }
  const visitedAt = new Date(parts[0]!);
  const createdAt = new Date(parts[1]!);
  if (Number.isNaN(visitedAt.getTime()) || Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Invalid cursor');
  }
  return { visitedAt, createdAt, id: parts[2]! };
}
