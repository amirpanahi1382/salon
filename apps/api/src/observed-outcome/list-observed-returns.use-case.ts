import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { toObservedReturnResponse } from './observed-outcome.mapper';
import { ObservedOutcomeRepository } from './observed-outcome.repository';
import type { ListObservedReturnsQueryDto } from './observed-outcome.dto';
import { OBSERVED_RETURN_LIST_LIMIT, pageObservedReturns } from './page-observed-returns';

@Injectable()
export class ListObservedReturnsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly outcomes: ObservedOutcomeRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    query: ListObservedReturnsQueryDto,
  ) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const newestFirst = await this.outcomes.listAssociations(principal.tenantId, customer.id);
    const pageRows = pageObservedReturns(
      newestFirst,
      parseObservedReturnCursor(query.cursor),
      OBSERVED_RETURN_LIST_LIMIT,
    );
    const pageVisitIds = pageRows
      .slice(0, OBSERVED_RETURN_LIST_LIMIT)
      .map((row) => row.returnVisit.id);
    const revenue = await this.outcomes.completedRevenueByVisit(
      principal.tenantId,
      customer.id,
      pageVisitIds,
    );

    return toListPage(
      pageRows.map((row) => {
        const amountMinor = revenue.get(row.returnVisit.id);
        return toObservedReturnResponse(row, {
          recorded: amountMinor != null,
          amountMinor: amountMinor ?? null,
        });
      }),
      OBSERVED_RETURN_LIST_LIMIT,
      (item) => {
        const match = pageRows.find((row) => row.returnVisit.id === item.observedReturn.visitId);
        const visit = match?.returnVisit;
        if (!visit) {
          throw new ValidationError('Invalid cursor');
        }
        return encodeCursor([visit.visitedAt.toISOString(), visit.createdAt.toISOString(), visit.id]);
      },
    );
  }
}

export function parseObservedReturnCursor(cursor?: string) {
  const parts = decodeCursor(cursor, 3);
  if (!parts) {
    return undefined;
  }
  const visitedAt = new Date(parts[0]!);
  const createdAt = new Date(parts[1]!);
  if (Number.isNaN(visitedAt.getTime()) || Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Invalid cursor');
  }
  return { id: parts[2]!, visitedAt, createdAt };
}
