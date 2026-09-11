import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  emptyRevenueMetrics,
  NotFoundError,
  revenueOpportunities,
  revenueSignals,
  utcNow,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import { loadCustomerRevenue } from './intelligence-revenue';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { toCustomerIntelligenceResponse } from './intelligence.mapper';
import { loadSuppressedOpportunityKeys, suppressedOpportunityKey } from '../action/opportunity-suppression';

@Injectable()
export class GetCustomerIntelligenceUseCase {
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string) {
    const row = await this.intelligence.loadCustomer(principal.tenantId, customerId);
    if (!row) {
      throw new NotFoundError('Customer not found');
    }
    const revenue = await loadCustomerRevenue(
      this.prisma.client,
      principal.tenantId,
      customerId,
      utcNow(),
    );
    const { behavior, result } = analyzeCustomerBehavior(
      row.behavior,
      this.intelligence.getAnalyzer(),
    );
    const suppressed = await loadSuppressedOpportunityKeys(
      this.prisma.client,
      principal.tenantId,
    );
    const combined = {
      ...result,
      signals: [...result.signals, ...revenueSignals(revenue)],
      opportunities: [...result.opportunities, ...revenueOpportunities(revenue)].filter(
        (opportunity) =>
          !suppressed.has(suppressedOpportunityKey(customerId, opportunity.type)),
      ),
    };
    return toCustomerIntelligenceResponse(row.customer, behavior, combined, revenue ?? emptyRevenueMetrics());
  }
}
