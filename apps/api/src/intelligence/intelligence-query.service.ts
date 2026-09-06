import { Injectable } from '@nestjs/common';
import {
  RuleBasedRetentionAnalyzer,
  utcNow,
  type CustomerStatus,
  type OpportunityType,
  type RetentionAnalyzer,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  loadCustomerBehaviorRow,
  loadSalonBehaviorRows,
  type SalonBehaviorRow,
} from './intelligence-aggregates';

@Injectable()
export class IntelligenceQueryService {
  private readonly analyzer: RetentionAnalyzer = new RuleBasedRetentionAnalyzer();

  constructor(private readonly prisma: PrismaService) {}

  getAnalyzer(): RetentionAnalyzer {
    return this.analyzer;
  }

  loadCustomer(tenantId: string, customerId: string, asOf = utcNow()) {
    return loadCustomerBehaviorRow(this.prisma.client, tenantId, customerId, asOf);
  }

  loadSalon(tenantId: string, asOf = utcNow()) {
    return loadSalonBehaviorRows(this.prisma.client, tenantId, asOf);
  }

  filterByStatus(status: CustomerStatus | undefined, current: CustomerStatus): boolean {
    return !status || current === status;
  }

  filterByOpportunityType(
    type: OpportunityType | undefined,
    types: OpportunityType[],
  ): boolean {
    return !type || types.includes(type);
  }
}

export type { SalonBehaviorRow };
