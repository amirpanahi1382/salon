import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from './customer.repository';
import { toCustomerResponse } from './customer.mapper';

@Injectable()
export class GetCustomerUseCase {
  constructor(private readonly customers: CustomerRepository) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string) {
    const customer = await this.customers.findById(principal.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    return toCustomerResponse(customer);
  }
}
