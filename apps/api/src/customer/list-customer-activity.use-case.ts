import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { CustomerActivityRepository } from './customer-activity.repository';
import {
  CUSTOMER_ACTIVITY_LIST_LIMIT,
  parseCustomerActivityCursor,
  type CustomerActivityRow,
} from './customer-activity';
import type { CustomerActivityItemDto, ListCustomerActivityQueryDto } from './customer.dto';
import { CustomerRepository } from './customer.repository';

@Injectable()
export class ListCustomerActivityUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly activity: CustomerActivityRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    query: ListCustomerActivityQueryDto,
  ) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    const rows = await this.activity.listForCustomer(
      principal.tenantId,
      customer.id,
      parseCustomerActivityCursor(query.cursor),
    );
    return toListPage(rows.map(toCustomerActivityItem), CUSTOMER_ACTIVITY_LIST_LIMIT, (item) =>
      encodeCursor([item.occurredAt, item.createdAt, item.type, item.id]),
    );
  }
}

export function toCustomerActivityItem(row: CustomerActivityRow): CustomerActivityItemDto {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    opportunityType: row.opportunityType,
  };
}
