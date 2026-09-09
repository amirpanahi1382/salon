import { Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal, OpportunityType } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { CreateActionUseCase } from './create-action.use-case';
import { ListActionsQueryDto, ListCustomerActionsQueryDto } from './action.dto';
import { ListActionsUseCase, ListCustomerActionsUseCase } from './list-actions.use-case';
import { OpportunityTypeParam } from './opportunity-type.param';
import { CompleteActionUseCase, DismissActionUseCase } from './transition-action.use-case';

@ApiTags('actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller()
export class ActionController {
  constructor(
    private readonly createAction: CreateActionUseCase,
    private readonly listActions: ListActionsUseCase,
    private readonly listCustomerActions: ListCustomerActionsUseCase,
    private readonly completeAction: CompleteActionUseCase,
    private readonly dismissAction: DismissActionUseCase,
  ) {}

  @Post('intelligence/opportunities/:opportunityType/customers/:customerId/actions')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original Action. Same key and different payload returns 409. Concurrent creates for the same OPEN opportunity return that Action.',
  })
  @ApiOperation({
    summary:
      'Record that the salon is acting on a currently derived opportunity. Does not send a message or create a visit.',
  })
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('opportunityType', OpportunityTypeParam) opportunityType: OpportunityType,
    @Param('customerId', UuidParam) customerId: string,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createAction.execute(
      user,
      customerId,
      opportunityType,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('actions')
  @ApiOperation({
    summary: 'List opportunity Actions for the authenticated salon, newest first',
  })
  list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ListActionsQueryDto) {
    return this.listActions.execute(user, query);
  }

  @Get('customers/:customerId/actions')
  @ApiOperation({ summary: 'List opportunity Actions for one customer' })
  listForCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListCustomerActionsQueryDto,
  ) {
    return this.listCustomerActions.execute(user, customerId, query);
  }

  @Post('actions/:id/complete')
  @ApiOperation({
    summary:
      'Confirm that the recommended action was performed. Does not mean the customer returned or that revenue was generated.',
  })
  complete(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.completeAction.execute(user, id);
  }

  @Post('actions/:id/dismiss')
  @ApiOperation({
    summary:
      'Record that the salon chose not to pursue this opportunity. Does not change customer intelligence.',
  })
  dismiss(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.dismissAction.execute(user, id);
  }
}
