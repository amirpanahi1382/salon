import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import { GetTransactionUseCase } from './get-transaction.use-case';
import { ListTransactionsUseCase } from './list-transactions.use-case';
import { CreateTransactionDto, ListTransactionsQueryDto } from './transaction.dto';
import { VoidTransactionUseCase } from './void-transaction.use-case';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TransactionController {
  constructor(
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly getTransaction: GetTransactionUseCase,
    private readonly listTransactions: ListTransactionsUseCase,
    private readonly voidTransaction: VoidTransactionUseCase,
  ) {}

  @Post('transactions')
  @Roles('OWNER', 'MANAGER')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Required. Same key and payload replay the original transaction. Same key and different payload returns 409.',
  })
  @ApiOperation({ summary: 'Record a completed financial transaction (not inferred from visits)' })
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createTransaction.execute(user, body, requireIdempotencyKey(idempotencyKey));
  }

  @Get('transactions')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List salon transactions, newest first (UTC occurredAt)' })
  list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ListTransactionsQueryDto) {
    return this.listTransactions.execute(user, query);
  }

  @Get('transactions/:id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get a transaction in the authenticated salon' })
  getById(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.getTransaction.execute(user, id);
  }

  @Post('transactions/:id/void')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Void a completed transaction so it no longer counts as revenue' })
  voidById(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.voidTransaction.execute(user, id);
  }

  @Get('customers/:customerId/transactions')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List transactions for one customer' })
  listForCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.listTransactions.execute(user, { ...query, customerId });
  }
}
