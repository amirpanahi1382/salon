import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { CreateCustomerUseCase } from './create-customer.use-case';
import { CreateCustomerDto, ListCustomersQueryDto, UpdateCustomerDto } from './customer.dto';
import { GetCustomerUseCase } from './get-customer.use-case';
import { ListCustomersUseCase } from './list-customers.use-case';
import { UpdateCustomerUseCase } from './update-customer.use-case';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly createCustomer: CreateCustomerUseCase,
    private readonly listCustomers: ListCustomersUseCase,
    private readonly getCustomer: GetCustomerUseCase,
    private readonly updateCustomer: UpdateCustomerUseCase,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List or search customers in the authenticated salon' })
  list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ListCustomersQueryDto) {
    return this.listCustomers.execute(user, query.q);
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Create a customer in the authenticated salon' })
  create(@CurrentUser() user: AuthenticatedPrincipal, @Body() body: CreateCustomerDto) {
    return this.createCustomer.execute(user, body);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get a customer in the authenticated salon' })
  getById(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.getCustomer.execute(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a customer in the authenticated salon' })
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.updateCustomer.execute(user, id, body);
  }
}
