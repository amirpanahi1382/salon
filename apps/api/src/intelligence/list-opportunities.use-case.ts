import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  revenueOpportunities,
  utcNow,
  type AuthenticatedPrincipal,
  type OpportunityType,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { decodeCursor, encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { IntelligenceQueryService } from './intelligence-query.service';
import { loadCustomerRevenueMap } from './intelligence-revenue';
import { toOpportunityDto } from './intelligence.mapper';
import { loadSuppressedOpportunityKeys, suppressedOpportunityKey } from '../action/opportunity-suppression';

export const INTELLIGENCE_LIST_LIMIT = 200;

@Injectable()
export class ListOpportunitiesUseCase {
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    type?: OpportunityType,
    cursor?: string,
  ) {
    const asOf = utcNow();
    const [{ rows, truncated }, revenueByCustomer, suppressed] = await Promise.all([
      this.intelligence.loadSalon(principal.tenantId, asOf),
      loadCustomerRevenueMap(this.prisma.client, principal.tenantId, asOf),
      loadSuppressedOpportunityKeys(this.prisma.client, principal.tenantId),
    ]);
    const opportunities: Array<{
      daysSinceLastVisit: number;
      customerId: string;
      type: OpportunityType;
      dto: ReturnType<typeof toOpportunityDto>;
    }> = [];

    for (const row of rows) {
      const { behavior, result } = analyzeCustomerBehavior(
        row.behavior,
        this.intelligence.getAnalyzer(),
      );
      const revenue = revenueByCustomer.get(row.customer.id);
      const opportunitiesForCustomer = [
        ...result.opportunities,
        ...(revenue ? revenueOpportunities(revenue) : []),
      ];
      for (const opportunity of opportunitiesForCustomer) {
        if (!this.intelligence.filterByOpportunityType(type, [opportunity.type])) {
          continue;
        }
        if (suppressed.has(suppressedOpportunityKey(row.customer.id, opportunity.type))) {
          continue;
        }
        opportunities.push({
          daysSinceLastVisit: behavior.daysSinceLastVisit ?? 0,
          customerId: row.customer.id,
          type: opportunity.type,
          dto: toOpportunityDto(row.customer, result.status, opportunity),
        });
      }
    }

    opportunities.sort((a, b) => {
      if (b.daysSinceLastVisit !== a.daysSinceLastVisit) {
        return b.daysSinceLastVisit - a.daysSinceLastVisit;
      }
      if (a.customerId !== b.customerId) {
        return a.customerId < b.customerId ? 1 : -1;
      }
      return a.type < b.type ? 1 : a.type > b.type ? -1 : 0;
    });

    const cursorParts = decodeCursor(cursor, 3);
    const filtered = cursorParts
      ? opportunities.filter((item) =>
          isAfterOpportunityCursor(item, Number(cursorParts[0]), cursorParts[1]!, cursorParts[2]!),
        )
      : opportunities;

    const page = toListPage(filtered, INTELLIGENCE_LIST_LIMIT, (item) =>
      encodeCursor([String(item.daysSinceLastVisit), item.customerId, item.type]),
    );
    return {
      items: page.items.map((item) => item.dto),
      hasMore: page.hasMore || truncated,
      nextCursor: page.nextCursor,
    };
  }
}

function isAfterOpportunityCursor(
  item: { daysSinceLastVisit: number; customerId: string; type: OpportunityType },
  days: number,
  customerId: string,
  type: string,
): boolean {
  if (item.daysSinceLastVisit < days) {
    return true;
  }
  if (item.daysSinceLastVisit > days) {
    return false;
  }
  if (item.customerId !== customerId) {
    return item.customerId < customerId;
  }
  return item.type < type;
}
