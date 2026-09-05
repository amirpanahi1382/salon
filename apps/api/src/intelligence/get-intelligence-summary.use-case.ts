import { Injectable } from '@nestjs/common';
import { analyzeCustomerVisits, type AuthenticatedPrincipal } from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import type { IntelligenceSummaryResponseDto } from './intelligence.dto';

@Injectable()
export class GetIntelligenceSummaryUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(principal: AuthenticatedPrincipal): Promise<IntelligenceSummaryResponseDto> {
    const snapshots = await this.intelligence.loadSalon(principal.tenantId);
    const summary: IntelligenceSummaryResponseDto = {
      customers: snapshots.length,
      new: 0,
      active: 0,
      returning: 0,
      atRisk: 0,
      inactive: 0,
      reactivationOpportunities: 0,
      customerReturnOpportunities: 0,
      frequent: 0,
    };

    for (const snapshot of snapshots) {
      const { result } = analyzeCustomerVisits(
        snapshot.visitDates,
        snapshot.asOf,
        this.intelligence.getAnalyzer(),
      );
      switch (result.status) {
        case 'NEW':
          summary.new += 1;
          break;
        case 'ACTIVE':
          summary.active += 1;
          break;
        case 'RETURNING':
          summary.returning += 1;
          break;
        case 'AT_RISK':
          summary.atRisk += 1;
          break;
        case 'INACTIVE':
          summary.inactive += 1;
          break;
      }
      if (result.signals.includes('FREQUENT')) {
        summary.frequent += 1;
      }
      for (const opportunity of result.opportunities) {
        if (opportunity.type === 'REACTIVATION') {
          summary.reactivationOpportunities += 1;
        }
        if (opportunity.type === 'CUSTOMER_RETURN') {
          summary.customerReturnOpportunities += 1;
        }
      }
    }

    return summary;
  }
}
