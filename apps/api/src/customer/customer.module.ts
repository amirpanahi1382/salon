import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreateCustomerUseCase } from './create-customer.use-case';
import { CustomerController } from './customer.controller';
import { CustomerRepository } from './customer.repository';
import { DeleteCustomerUseCase } from './delete-customer.use-case';
import { GetCustomerUseCase } from './get-customer.use-case';
import { ListCustomersUseCase } from './list-customers.use-case';
import { UpdateCustomerUseCase } from './update-customer.use-case';
import { ImportCustomersUseCase } from './import-customers.use-case';

@Module({
  imports: [AuthModule],
  controllers: [CustomerController],
  providers: [
    CustomerRepository,
    CreateCustomerUseCase,
    ImportCustomersUseCase,
    ListCustomersUseCase,
    GetCustomerUseCase,
    UpdateCustomerUseCase,
    DeleteCustomerUseCase,
  ],
  exports: [CustomerRepository],
})
export class CustomerModule {}
