import { Injectable } from '@nestjs/common';
import {
  RuleBasedRetentionAnalyzer,
  utcNow,
  type CustomerStatus,
  type OpportunityType,
  type RetentionAnalyzer,
} from '@salon/shared';
import { CustomerRepository, INTELLIGENCE_CUSTOMER_CAP } from '../customer/customer.repository';
import { VisitRepository } from '../visit/visit.repository';
import type { CustomerIdentity } from './intelligence.mapper';

export type CustomerIntelligenceSnapshot = {
  customer: CustomerIdentity;
  visitDates: Date[];
  asOf: Date;
};

@Injectable()
export class IntelligenceQueryService {
  private readonly analyzer: RetentionAnalyzer = new RuleBasedRetentionAnalyzer();

  constructor(
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
  ) {}

  getAnalyzer(): RetentionAnalyzer {
    return this.analyzer;
  }

  async loadCustomer(tenantId: string, customerId: string, asOf = utcNow()) {
    const customer = await this.customers.findById(tenantId, customerId);
    if (!customer) {
      return null;
    }
    const rows = await this.visits.listVisitedAtForCustomer(tenantId, customerId);
    return {
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
      },
      visitDates: rows.map((row) => row.visitedAt),
      asOf,
    } satisfies CustomerIntelligenceSnapshot;
  }

  async loadSalon(tenantId: string, asOf = utcNow()) {
    const identityRows = await this.customers.listIdentity(tenantId);
    const truncated = identityRows.length > INTELLIGENCE_CUSTOMER_CAP;
    const customers = truncated
      ? identityRows.slice(0, INTELLIGENCE_CUSTOMER_CAP)
      : identityRows;
    const visitRows = await this.visits.listVisitedAtForSalon(
      tenantId,
      customers.map((row) => row.id),
    );

    const datesByCustomer = new Map<string, Date[]>();
    for (const row of visitRows) {
      const dates = datesByCustomer.get(row.customerId) ?? [];
      dates.push(row.visitedAt);
      datesByCustomer.set(row.customerId, dates);
    }

    return {
      truncated,
      snapshots: customers.map((customer) => ({
        customer,
        visitDates: datesByCustomer.get(customer.id) ?? [],
        asOf,
      })) satisfies CustomerIntelligenceSnapshot[],
    };
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
