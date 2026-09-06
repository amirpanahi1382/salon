import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  deriveRevenueTrend,
  formatMoneyString,
  revenueOpportunities,
  utcNow,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { IntelligenceQueryService } from './intelligence-query.service';
import { loadCustomerRevenueMap, loadSalonRevenueTotals } from './intelligence-revenue';
import type { IntelligenceSummaryResponseDto } from './intelligence.dto';

@Injectable()
export class GetIntelligenceSummaryUseCase {
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(principal: AuthenticatedPrincipal): Promise<IntelligenceSummaryResponseDto> {
    const asOf = utcNow();
    const [{ rows, truncated }, salonRevenue, revenueByCustomer] = await Promise.all([
      this.intelligence.loadSalon(principal.tenantId, asOf),
      loadSalonRevenueTotals(this.prisma.client, principal.tenantId, asOf),
      loadCustomerRevenueMap(this.prisma.client, principal.tenantId, asOf),
    ]);
    const summary: IntelligenceSummaryResponseDto = {
      customers: rows.length,
      new: 0,
      active: 0,
      returning: 0,
      atRisk: 0,
      inactive: 0,
      reactivationOpportunities: 0,
      customerReturnOpportunities: 0,
      frequent: 0,
      hasMore: truncated,
      currency: 'IRR',
      totalRevenue: formatMoneyString(salonRevenue.totalRevenueMinor),
      completedTransactionCount: salonRevenue.transactionCount,
      revenueThisUtcMonth: formatMoneyString(salonRevenue.thisUtcMonthMinor),
      revenuePreviousUtcMonth: formatMoneyString(salonRevenue.previousUtcMonthMinor),
      revenueTrend: deriveRevenueTrend(salonRevenue),
      revenueDeclineOpportunities: 0,
      reportingTime: 'UTC',
    };

    for (const row of rows) {
      const { result } = analyzeCustomerBehavior(row.behavior, this.intelligence.getAnalyzer());
      const revenue = revenueByCustomer.get(row.customer.id);
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
      if (revenue && revenueOpportunities(revenue).length > 0) {
        summary.revenueDeclineOpportunities += 1;
      }
    }

    return summary;
  }
}
