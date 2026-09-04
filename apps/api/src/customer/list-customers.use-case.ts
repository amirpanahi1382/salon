import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from './customer.repository';
import { toCustomerResponse } from './customer.mapper';

@Injectable()
export class ListCustomersUseCase {
  constructor(private readonly customers: CustomerRepository) {}

  async execute(principal: AuthenticatedPrincipal, search?: string) {
    const rows = await this.customers.list(principal.tenantId, search);
    return rows.map(toCustomerResponse);
  }
}
