import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  type AuthenticatedPrincipal,
  type CustomerStatus,
} from '@salon/shared';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toSegmentItem } from './intelligence.mapper';
import { INTELLIGENCE_LIST_LIMIT } from './list-opportunities.use-case';

@Injectable()
export class ListCustomerSegmentsUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(
    principal: AuthenticatedPrincipal,
    status?: CustomerStatus,
    cursor?: string,
  ) {
    const { rows, truncated } = await this.intelligence.loadSalon(principal.tenantId);
    const items = [];

    for (const row of rows) {
      const { behavior, result } = analyzeCustomerBehavior(
        row.behavior,
        this.intelligence.getAnalyzer(),
      );
      if (!this.intelligence.filterByStatus(status, result.status)) {
        continue;
      }
      items.push({
        daysSinceLastVisit: behavior.daysSinceLastVisit ?? -1,
        customerId: row.customer.id,
        dto: toSegmentItem(row.customer, behavior, result),
      });
    }

    items.sort((a, b) => {
      if (b.daysSinceLastVisit !== a.daysSinceLastVisit) {
        return b.daysSinceLastVisit - a.daysSinceLastVisit;
      }
      return a.customerId < b.customerId ? 1 : a.customerId > b.customerId ? -1 : 0;
    });

    const cursorParts = decodeCursor(cursor, 2);
    const filtered = cursorParts
      ? items.filter((item) => {
          const days = Number(cursorParts[0]);
          const customerId = cursorParts[1]!;
          if (item.daysSinceLastVisit < days) {
            return true;
          }
          if (item.daysSinceLastVisit > days) {
            return false;
          }
          return item.customerId < customerId;
        })
      : items;

    const page = toListPage(filtered, INTELLIGENCE_LIST_LIMIT, (item) =>
      encodeCursor([String(item.daysSinceLastVisit), item.customerId]),
    );
    return {
      items: page.items.map((item) => item.dto),
      hasMore: page.hasMore || truncated,
      nextCursor: page.nextCursor,
    };
  }
}
