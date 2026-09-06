import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { toServiceResponse } from './service.mapper';
import { SERVICE_LIST_LIMIT, ServiceRepository } from './service.repository';

@Injectable()
export class ListServicesUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(principal: AuthenticatedPrincipal, cursor?: string) {
    const parts = decodeCursor(cursor, 2);
    const cursorValue = parts
      ? { createdAt: new Date(parts[0]!), id: parts[1]! }
      : undefined;
    if (cursorValue && Number.isNaN(cursorValue.createdAt.getTime())) {
      throw new ValidationError('Invalid cursor');
    }
    const rows = await this.services.list(principal.tenantId, cursorValue);
    const page = toListPage(rows, SERVICE_LIST_LIMIT, (row) =>
      encodeCursor([row.createdAt.toISOString(), row.id]),
    );
    return {
      items: page.items.map(toServiceResponse),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
