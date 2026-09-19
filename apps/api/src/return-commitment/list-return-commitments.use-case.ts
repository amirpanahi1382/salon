import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { RETURN_COMMITMENT_LIST_LIMIT, resolveUpcomingWindow } from './upcoming-window';
import type {
  ListOpenReturnCommitmentsQueryDto,
  ListReturnCommitmentsQueryDto,
  ListUpcomingReturnCommitmentsQueryDto,
} from './return-commitment.dto';
import {
  toOpenReturnCommitmentItem,
  toUpcomingReturnCommitmentItem,
  type ReturnCommitmentRow,
} from './return-commitment.mapper';
import { ReturnCommitmentRepository } from './return-commitment.repository';

@Injectable()
export class ListCustomerReturnCommitmentsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly commitments: ReturnCommitmentRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    query: ListReturnCommitmentsQueryDto,
  ) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    const cursor = parseExpectedAtCursor(query.cursor);
    const rows = await this.commitments.listForCustomer(principal.tenantId, customer.id, cursor);
    const items = await this.commitments.toReadModels(principal.tenantId, rows as ReturnCommitmentRow[]);
    return toListPage(items, RETURN_COMMITMENT_LIST_LIMIT, (item) =>
      encodeCursor([item.expectedAt, item.id]),
    );
  }
}

@Injectable()
export class ListUpcomingReturnCommitmentsUseCase {
  constructor(private readonly commitments: ReturnCommitmentRepository) {}

  async execute(principal: AuthenticatedPrincipal, query: ListUpcomingReturnCommitmentsQueryDto) {
    const window = resolveUpcomingWindow(query.from, query.to);
    const cursor = parseExpectedAtCursor(query.cursor);
    const rows = await this.commitments.listUpcoming(
      principal.tenantId,
      window.from,
      window.to,
      cursor,
    );
    const page = toListPage(
      rows.map(toUpcomingReturnCommitmentItem),
      RETURN_COMMITMENT_LIST_LIMIT,
      (item) => encodeCursor([item.expectedAt, item.id]),
    );
    return {
      ...page,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
  }
}

@Injectable()
export class ListOpenReturnCommitmentsUseCase {
  constructor(private readonly commitments: ReturnCommitmentRepository) {}

  async execute(principal: AuthenticatedPrincipal, query: ListOpenReturnCommitmentsQueryDto) {
    const cursor = parseExpectedAtCursor(query.cursor);
    const rows = await this.commitments.listOpen(principal.tenantId, cursor);
    const now = new Date();
    return toListPage(
      rows.map((row) =>
        toOpenReturnCommitmentItem(
          {
            id: row.id,
            customerId: row.customer_id,
            expectedAt: row.expected_at,
            createdByPlatformAdminId: row.created_by_platform_admin_id,
            firstName: row.first_name,
            lastName: row.last_name,
            phoneNumber: row.phone_number,
          },
          now,
        ),
      ),
      RETURN_COMMITMENT_LIST_LIMIT,
      (item) => encodeCursor([item.expectedAt, item.id]),
    );
  }
}

function parseExpectedAtCursor(cursor?: string) {
  const parts = decodeCursor(cursor, 2);
  if (!parts) {
    return undefined;
  }
  const expectedAt = new Date(parts[0]!);
  if (Number.isNaN(expectedAt.getTime())) {
    throw new ValidationError('Invalid cursor');
  }
  return { expectedAt, id: parts[1]! };
}
