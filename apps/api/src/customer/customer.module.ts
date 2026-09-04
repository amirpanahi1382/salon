import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreateCustomerUseCase } from './create-customer.use-case';
import { CustomerController } from './customer.controller';
import { CustomerRepository } from './customer.repository';
import { GetCustomerUseCase } from './get-customer.use-case';
import { ListCustomersUseCase } from './list-customers.use-case';
import { UpdateCustomerUseCase } from './update-customer.use-case';

@Module({
  imports: [AuthModule],
  controllers: [CustomerController],
  providers: [
    CustomerRepository,
    CreateCustomerUseCase,
    ListCustomersUseCase,
    GetCustomerUseCase,
    UpdateCustomerUseCase,
  ],
  exports: [CustomerRepository],
})
export class CustomerModule {}
