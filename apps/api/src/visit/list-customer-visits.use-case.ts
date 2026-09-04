import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { VisitRepository } from './visit.repository';
import { toVisitResponse } from './visit.mapper';

@Injectable()
export class ListCustomerVisitsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const rows = await this.visits.listForCustomer(principal.tenantId, customer.id);
    return rows.map(toVisitResponse);
  }
}
