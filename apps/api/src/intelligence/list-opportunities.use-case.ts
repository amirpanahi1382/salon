import { Injectable } from '@nestjs/common';
import { analyzeCustomerVisits, type AuthenticatedPrincipal, type OpportunityType } from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toOpportunityDto } from './intelligence.mapper';

@Injectable()
export class ListOpportunitiesUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(principal: AuthenticatedPrincipal, type?: OpportunityType) {
    const { snapshots, truncated } = await this.intelligence.loadSalon(principal.tenantId);
    const opportunities: Array<{
      daysSinceLastVisit: number;
      dto: ReturnType<typeof toOpportunityDto>;
    }> = [];

    for (const snapshot of snapshots) {
      const { behavior, result } = analyzeCustomerVisits(
        snapshot.visitDates,
        snapshot.asOf,
        this.intelligence.getAnalyzer(),
      );
      for (const opportunity of result.opportunities) {
        if (!this.intelligence.filterByOpportunityType(type, [opportunity.type])) {
          continue;
        }
        opportunities.push({
          daysSinceLastVisit: behavior.daysSinceLastVisit ?? 0,
          dto: toOpportunityDto(snapshot.customer, result.status, opportunity),
        });
      }
    }

    return {
      items: opportunities
        .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit)
        .map((item) => item.dto),
      hasMore: truncated,
    };
  }
}
