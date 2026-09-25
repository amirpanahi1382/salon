import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  revenueOpportunities,
  type AuthenticatedPrincipal,
  type OpportunityType,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { loadSuppressedOpportunityKeys, suppressedOpportunityKey } from '../action/opportunity-suppression';
import { loadCustomerRevenueMap } from './intelligence-revenue';
import { parseOpportunityCursor, opportunityCursor, type OpportunityPosition } from './intelligence-cursor';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toOpportunityDto } from './intelligence.mapper';
import { INTELLIGENCE_SCAN_BATCH_SIZE } from './intelligence-aggregates';

export const INTELLIGENCE_LIST_LIMIT = 200;

@Injectable()
export class ListOpportunitiesUseCase {
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(principal: AuthenticatedPrincipal, type?: OpportunityType, cursor?: string) {
    const { asOf, position } = parseOpportunityCursor(cursor, type);
    const items: Array<OpportunityPosition & { dto: ReturnType<typeof toOpportunityDto> }> = [];
    let after = position
      ? { days: position.days, id: position.customerId, inclusive: true }
      : undefined;

    while (items.length <= INTELLIGENCE_LIST_LIMIT) {
      const rows = await this.intelligence.loadRankedChunk(principal.tenantId, asOf, 0, after);
      if (rows.length === 0) break;
      const ids = rows.map((row) => row.customer.id);
      const [revenueByCustomer, suppressed] = await Promise.all([
        loadCustomerRevenueMap(this.prisma.client, principal.tenantId, asOf, ids),
        loadSuppressedOpportunityKeys(this.prisma.client, principal.tenantId, ids),
      ]);

      for (const row of rows) {
        const { behavior, result } = analyzeCustomerBehavior(
          row.behavior,
          this.intelligence.getAnalyzer(),
        );
        const revenue = revenueByCustomer.get(row.customer.id);
        const opportunities = [
          ...result.opportunities,
          ...(revenue ? revenueOpportunities(revenue) : []),
        ].sort((a, b) => (a.type < b.type ? 1 : a.type > b.type ? -1 : 0));
        for (const opportunity of opportunities) {
          if (!this.intelligence.filterByOpportunityType(type, [opportunity.type])) continue;
          if (suppressed.has(suppressedOpportunityKey(row.customer.id, opportunity.type))) continue;
          const item = {
            days: row.rankDays,
            customerId: row.customer.id,
            type: opportunity.type,
          };
          if (position && !isAfterOpportunityCursor(item, position)) continue;
          items.push({
            ...item,
            dto: toOpportunityDto(row.customer, result.status, opportunity),
          });
          if (items.length > INTELLIGENCE_LIST_LIMIT) break;
        }
        if (items.length > INTELLIGENCE_LIST_LIMIT) break;
      }
      if (items.length > INTELLIGENCE_LIST_LIMIT || rows.length < INTELLIGENCE_SCAN_BATCH_SIZE) break;
      const last = rows.at(-1)!;
      after = { days: last.rankDays, id: last.customer.id, inclusive: false };
    }

    const hasMore = items.length > INTELLIGENCE_LIST_LIMIT;
    const page = items.slice(0, INTELLIGENCE_LIST_LIMIT);
    const last = page.at(-1);
    return {
      items: page.map((item) => item.dto),
      hasMore,
      nextCursor: hasMore && last ? opportunityCursor(asOf, type, last) : null,
    };
  }
}

function isAfterOpportunityCursor(item: OpportunityPosition, cursor: OpportunityPosition): boolean {
  if (item.days !== cursor.days) return item.days < cursor.days;
  if (item.customerId !== cursor.customerId) return item.customerId < cursor.customerId;
  return item.type < cursor.type;
}
