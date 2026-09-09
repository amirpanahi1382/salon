import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { ActionRepository, ACTION_LIST_LIMIT } from './action.repository';
import { toActionResponse } from './action.mapper';
import type { ListActionsQueryDto } from './action.dto';

@Injectable()
export class ListActionsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly actions: ActionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, query: ListActionsQueryDto) {
    let customerId: string | undefined;
    if (query.customerId) {
      const customer = await this.customers.findById(principal.tenantId, query.customerId);
      if (!customer) {
        throw new NotFoundError('Customer not found');
      }
      customerId = customer.id;
    }

    const rows = await this.actions.list(principal.tenantId, {
      customerId,
      status: query.status,
      cursor: parseActionCursor(query.cursor),
    });
    return toListPage(rows.map(toActionResponse), ACTION_LIST_LIMIT, (item) =>
      encodeCursor([item.createdAt, item.id]),
    );
  }
}

@Injectable()
export class ListCustomerActionsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly actions: ActionRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    query: { status?: ListActionsQueryDto['status']; cursor?: string },
  ) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    const rows = await this.actions.list(principal.tenantId, {
      customerId: customer.id,
      status: query.status,
      cursor: parseActionCursor(query.cursor),
    });
    return toListPage(rows.map(toActionResponse), ACTION_LIST_LIMIT, (item) =>
      encodeCursor([item.createdAt, item.id]),
    );
  }
}

function parseActionCursor(cursor?: string) {
  const parts = decodeCursor(cursor, 2);
  if (!parts) {
    return undefined;
  }
  const createdAt = new Date(parts[0]!);
  if (Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Invalid cursor');
  }
  return { createdAt, id: parts[1]! };
}
