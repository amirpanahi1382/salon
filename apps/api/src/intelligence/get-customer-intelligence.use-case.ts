import { Injectable } from '@nestjs/common';
import { NotFoundError, analyzeCustomerVisits, type AuthenticatedPrincipal } from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toCustomerIntelligenceResponse } from './intelligence.mapper';

@Injectable()
export class GetCustomerIntelligenceUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string) {
    const snapshot = await this.intelligence.loadCustomer(principal.tenantId, customerId);
    if (!snapshot) {
      throw new NotFoundError('Customer not found');
    }
    const { behavior, result } = analyzeCustomerVisits(
      snapshot.visitDates,
      snapshot.asOf,
      this.intelligence.getAnalyzer(),
    );
    return toCustomerIntelligenceResponse(snapshot.customer, behavior, result);
  }
}
