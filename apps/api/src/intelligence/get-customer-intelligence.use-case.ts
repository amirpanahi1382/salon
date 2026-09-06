import { Injectable } from '@nestjs/common';
import { NotFoundError, analyzeCustomerBehavior, type AuthenticatedPrincipal } from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import { toCustomerIntelligenceResponse } from './intelligence.mapper';

@Injectable()
export class GetCustomerIntelligenceUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string) {
    const row = await this.intelligence.loadCustomer(principal.tenantId, customerId);
    if (!row) {
      throw new NotFoundError('Customer not found');
    }
    const { behavior, result } = analyzeCustomerBehavior(
      row.behavior,
      this.intelligence.getAnalyzer(),
    );
    return toCustomerIntelligenceResponse(row.customer, behavior, result);
  }
}
