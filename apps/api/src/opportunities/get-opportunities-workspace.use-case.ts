import { Injectable } from '@nestjs/common';
import {
  comparableJalaliMonthWindows,
  ValidationError,
  type AuthenticatedPrincipal,
  type OpportunityWorkspaceFilter,
} from '@salon/shared';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import { OpportunitiesWorkspaceQueryDto } from './opportunities.dto';
import { toOpportunityWorkspaceRow } from './opportunities-workspace.mapper';
import {
  OPPORTUNITY_WORKSPACE_LIMIT,
  OpportunitiesWorkspaceRepository,
} from './opportunities-workspace.repository';

@Injectable()
export class GetOpportunitiesWorkspaceUseCase {
  constructor(private readonly workspace: OpportunitiesWorkspaceRepository) {}

  async execute(
    principal: AuthenticatedPrincipal,
    query: OpportunitiesWorkspaceQueryDto,
    now = new Date(),
  ) {
    const filter = query.filter;
    if (filter === 'REVENUE_DROP') {
      return this.listRevenueDrop(principal.tenantId, query.cursor, now);
    }
    return this.listMessaging(principal.tenantId, filter, query.cursor);
  }

  private async listMessaging(
    tenantId: string,
    filter: Exclude<OpportunityWorkspaceFilter, 'REVENUE_DROP'>,
    cursorValue?: string,
  ) {
    const cursorParts = decodeCursor(cursorValue, 2);
    const cursor = cursorParts
      ? { sortAt: parseCursorInstant(cursorParts[0]!), stableId: parseWorkspaceId(cursorParts[1]!) }
      : undefined;
    const rows = await this.workspace.listMessaging(tenantId, filter, cursor);
    const page = toListPage(rows, OPPORTUNITY_WORKSPACE_LIMIT, (row) => {
      const mapped = toOpportunityWorkspaceRow(row);
      return encodeCursor([row.sortAt.toISOString(), mapped.stableId]);
    });
    return {
      items: page.items.map(toOpportunityWorkspaceRow),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  private async listRevenueDrop(tenantId: string, cursorValue: string | undefined, now: Date) {
    const windows = comparableJalaliMonthWindows(now);
    const cursorParts = decodeCursor(cursorValue, 2);
    const cursor = cursorParts
      ? { previousVisitAt: parseCursorInstant(cursorParts[0]!), customerId: parseCursorUuid(cursorParts[1]!) }
      : undefined;
    const rows = await this.workspace.listRevenueDrop(tenantId, windows, cursor);
    const page = toListPage(rows, OPPORTUNITY_WORKSPACE_LIMIT, (row) =>
      encodeCursor([
        (row.previousVisitAt ?? row.sortAt).toISOString(),
        row.customerId ?? row.stableSubject,
      ]),
    );
    return {
      items: page.items.map(toOpportunityWorkspaceRow),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

function parseWorkspaceId(value: string): string {
  const [kind, id, extra] = value.split(':');
  if (extra !== undefined || !['SALON_CUSTOMER', 'VIP_RECIPIENT'].includes(kind ?? '')) {
    throw new ValidationError('Invalid cursor');
  }
  parseCursorUuid(id ?? '');
  return value;
}
