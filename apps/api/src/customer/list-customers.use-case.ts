import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository, CUSTOMER_LIST_LIMIT } from './customer.repository';
import { toCustomerResponse } from './customer.mapper';
import { toListPage } from '../infrastructure/http/list-page';

@Injectable()
export class ListCustomersUseCase {
  constructor(private readonly customers: CustomerRepository) {}

  async execute(principal: AuthenticatedPrincipal, search?: string) {
    const rows = await this.customers.list(principal.tenantId, search);
    return toListPage(rows.map(toCustomerResponse), CUSTOMER_LIST_LIMIT);
  }
}
