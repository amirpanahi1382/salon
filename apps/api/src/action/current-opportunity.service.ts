import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  revenueOpportunities,
  utcNow,
  type OpportunityType,
} from '@salon/shared';
import { loadCustomerRevenue } from '../intelligence/intelligence-revenue';
import { IntelligenceQueryService } from '../intelligence/intelligence-query.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class CurrentOpportunityService {
  constructor(
    private readonly intelligence: IntelligenceQueryService,
    private readonly prisma: PrismaService,
  ) {}

  async hasOpportunity(
    tenantId: string,
    customerId: string,
    type: OpportunityType,
  ): Promise<'missing-customer' | 'missing-opportunity' | 'present'> {
    const row = await this.intelligence.loadCustomer(tenantId, customerId);
    if (!row) {
      return 'missing-customer';
    }
    const revenue = await loadCustomerRevenue(
      this.prisma.client,
      tenantId,
      customerId,
      utcNow(),
    );
    const { result } = analyzeCustomerBehavior(row.behavior, this.intelligence.getAnalyzer());
    const types = [...result.opportunities, ...revenueOpportunities(revenue)].map(
      (opportunity) => opportunity.type,
    );
    return types.includes(type) ? 'present' : 'missing-opportunity';
  }
}
