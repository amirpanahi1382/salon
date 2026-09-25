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
import { loadSuppressedOpportunityKeys, suppressedOpportunityKey } from '../action/opportunity-suppression';

@Injectable()
export class GetIntelligenceSummaryUseCase {
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(principal: AuthenticatedPrincipal): Promise<IntelligenceSummaryResponseDto> {
    const asOf = utcNow();
    const salonRevenue = await loadSalonRevenueTotals(this.prisma.client, principal.tenantId, asOf);
    const summary: IntelligenceSummaryResponseDto = {
      customers: 0,
      new: 0,
      active: 0,
      returning: 0,
      atRisk: 0,
      inactive: 0,
      reactivationOpportunities: 0,
      customerReturnOpportunities: 0,
      frequent: 0,
      hasMore: false,
      currency: 'IRR',
      totalRevenue: formatMoneyString(salonRevenue.totalRevenueMinor),
      completedTransactionCount: salonRevenue.transactionCount,
      revenueThisUtcMonth: formatMoneyString(salonRevenue.thisUtcMonthMinor),
      revenuePreviousUtcMonth: formatMoneyString(salonRevenue.previousUtcMonthMinor),
      revenueTrend: deriveRevenueTrend(salonRevenue),
      revenueDeclineOpportunities: 0,
      reportingTime: 'UTC',
    };

    let after: { createdAt: Date; id: string } | undefined;
    while (true) {
      const { rows, next } = await this.intelligence.loadSalonChunk(principal.tenantId, asOf, after);
      if (rows.length === 0) break;
      const ids = rows.map((row) => row.customer.id);
      const [revenueByCustomer, suppressed] = await Promise.all([
        loadCustomerRevenueMap(this.prisma.client, principal.tenantId, asOf, ids),
        loadSuppressedOpportunityKeys(this.prisma.client, principal.tenantId, ids),
      ]);
      summary.customers += rows.length;
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
          if (suppressed.has(suppressedOpportunityKey(row.customer.id, opportunity.type))) {
            continue;
          }
          if (opportunity.type === 'REACTIVATION') {
            summary.reactivationOpportunities += 1;
          }
          if (opportunity.type === 'CUSTOMER_RETURN') {
            summary.customerReturnOpportunities += 1;
          }
        }
        if (
          revenue &&
          revenueOpportunities(revenue).length > 0 &&
          !suppressed.has(suppressedOpportunityKey(row.customer.id, 'REVENUE_DECLINE'))
        ) {
          summary.revenueDeclineOpportunities += 1;
        }
      }
      after = next;
    }

    return summary;
  }
}
