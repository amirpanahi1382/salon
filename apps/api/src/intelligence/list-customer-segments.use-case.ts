import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerVisits,
  type AuthenticatedPrincipal,
  type CustomerStatus,
} from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toSegmentItem } from './intelligence.mapper';

@Injectable()
export class ListCustomerSegmentsUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(principal: AuthenticatedPrincipal, status?: CustomerStatus) {
    const { snapshots, truncated } = await this.intelligence.loadSalon(principal.tenantId);
    const items = [];

    for (const snapshot of snapshots) {
      const { behavior, result } = analyzeCustomerVisits(
        snapshot.visitDates,
        snapshot.asOf,
        this.intelligence.getAnalyzer(),
      );
      if (!this.intelligence.filterByStatus(status, result.status)) {
        continue;
      }
      items.push(toSegmentItem(snapshot.customer, behavior, result));
    }

    return {
      items: items.sort((a, b) => {
        const daysA = a.daysSinceLastVisit ?? -1;
        const daysB = b.daysSinceLastVisit ?? -1;
        return daysB - daysA;
      }),
      hasMore: truncated,
    };
  }
}
