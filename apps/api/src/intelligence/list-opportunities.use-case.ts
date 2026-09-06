import { Injectable } from '@nestjs/common';
import { analyzeCustomerBehavior, type AuthenticatedPrincipal, type OpportunityType } from '@salon/shared';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toOpportunityDto } from './intelligence.mapper';

export const INTELLIGENCE_LIST_LIMIT = 200;

@Injectable()
export class ListOpportunitiesUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(
    principal: AuthenticatedPrincipal,
    type?: OpportunityType,
    cursor?: string,
  ) {
    const { rows, truncated } = await this.intelligence.loadSalon(principal.tenantId);
    const opportunities: Array<{
      daysSinceLastVisit: number;
      customerId: string;
      dto: ReturnType<typeof toOpportunityDto>;
    }> = [];

    for (const row of rows) {
      const { behavior, result } = analyzeCustomerBehavior(
        row.behavior,
        this.intelligence.getAnalyzer(),
      );
      for (const opportunity of result.opportunities) {
        if (!this.intelligence.filterByOpportunityType(type, [opportunity.type])) {
          continue;
        }
        opportunities.push({
          daysSinceLastVisit: behavior.daysSinceLastVisit ?? 0,
          customerId: row.customer.id,
          dto: toOpportunityDto(row.customer, result.status, opportunity),
        });
      }
    }

    opportunities.sort((a, b) => {
      if (b.daysSinceLastVisit !== a.daysSinceLastVisit) {
        return b.daysSinceLastVisit - a.daysSinceLastVisit;
      }
      return a.customerId < b.customerId ? 1 : a.customerId > b.customerId ? -1 : 0;
    });

    const cursorParts = decodeCursor(cursor, 2);
    const filtered = cursorParts
      ? opportunities.filter((item) =>
          isAfterOpportunityCursor(item, Number(cursorParts[0]), cursorParts[1]!),
        )
      : opportunities;

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

function isAfterOpportunityCursor(
  item: { daysSinceLastVisit: number; customerId: string },
  days: number,
  customerId: string,
): boolean {
  if (item.daysSinceLastVisit < days) {
    return true;
  }
  if (item.daysSinceLastVisit > days) {
    return false;
  }
  return item.customerId < customerId;
}
