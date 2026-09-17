import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { ListObservedReturnsUseCase } from './list-observed-returns.use-case';
import { ListObservedReturnsQueryDto } from './observed-outcome.dto';

@ApiTags('observed-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller()
export class ObservedOutcomeController {
  constructor(private readonly listObservedReturns: ListObservedReturnsUseCase) {}

  @Get('customers/:customerId/observed-returns')
  @ApiOperation({
    summary:
      'List observed (associated) returns after SENT customer message interventions. Not attributed or generated revenue. Newest return first.',
  })
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListObservedReturnsQueryDto,
  ) {
    return this.listObservedReturns.execute(user, customerId, query);
  }
}
