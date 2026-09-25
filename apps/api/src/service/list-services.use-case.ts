import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import { type AuthenticatedPrincipal } from '@salon/shared';
import { toServiceResponse } from './service.mapper';
import { SERVICE_LIST_LIMIT, ServiceRepository } from './service.repository';

@Injectable()
export class ListServicesUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(principal: AuthenticatedPrincipal, query: { cursor?: string; includeInactive?: string }) {
    const includeInactive = principal.role === 'OWNER' && query.includeInactive === 'true';
    const parts = decodeCursor(query.cursor, 2);
    const cursorValue = parts
      ? { createdAt: parseCursorInstant(parts[0]!), id: parseCursorUuid(parts[1]!) }
      : undefined;
    const rows = await this.services.list(principal.tenantId, {
      cursor: cursorValue,
      includeInactive,
    });
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
