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
  loadSalonBehaviorChunk,
  loadRankedSalonBehaviorChunk,
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

  loadSalonChunk(tenantId: string, asOf: Date, after?: { createdAt: Date; id: string }) {
    return loadSalonBehaviorChunk(this.prisma.client, tenantId, asOf, after);
  }

  loadRankedChunk(
    tenantId: string,
    asOf: Date,
    noVisitRank: -1 | 0,
    after?: { days: number; id: string; inclusive?: boolean },
  ) {
    return loadRankedSalonBehaviorChunk(this.prisma.client, tenantId, asOf, noVisitRank, after);
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
