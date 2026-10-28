import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  analyzeCustomerBehavior,
  revenueOpportunities,
  utcNow,
  type OpportunityType,
} from '@salon/shared';
import { loadCustomerRevenue } from '../intelligence/intelligence-revenue';
import { IntelligenceQueryService } from '../intelligence/intelligence-query.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { isOpportunitySuppressed } from './opportunity-suppression';

type OpportunityReadClient = Prisma.TransactionClient | PrismaService['client'];

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
    db: OpportunityReadClient = this.prisma.client,
  ): Promise<'missing-customer' | 'missing-opportunity' | 'present'> {
    const asOf = utcNow();
    const row = await this.intelligence.loadCustomer(tenantId, customerId, asOf, db);
    if (!row) {
      return 'missing-customer';
    }
    const revenue = await loadCustomerRevenue(db, tenantId, customerId, asOf);
    const { result } = analyzeCustomerBehavior(row.behavior, this.intelligence.getAnalyzer());
    const types = [...result.opportunities, ...revenueOpportunities(revenue)].map(
      (opportunity) => opportunity.type,
    );
    if (!types.includes(type)) {
      return 'missing-opportunity';
    }
    if (await isOpportunitySuppressed(db, tenantId, customerId, type)) {
      return 'missing-opportunity';
    }
    return 'present';
  }
}
