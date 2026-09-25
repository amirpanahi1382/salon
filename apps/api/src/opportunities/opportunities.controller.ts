import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { GetOpportunitiesWorkspaceUseCase } from './get-opportunities-workspace.use-case';
import { OpportunitiesWorkspaceQueryDto } from './opportunities.dto';

@ApiTags('opportunities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly getWorkspace: GetOpportunitiesWorkspaceUseCase) {}

  @Get('workspace')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({
    summary:
      'Paginated Opportunities V2 read model. ALL/SALON_MESSAGES/VIP are messaging execution facts; REVENUE_DROP is a visit-lapse candidate finder using comparable Jalali months in Asia/Tehran. Derived on read from MessageRequest, MessageDelivery, ReturnCommitment, and Visit. Not causal. Not the intelligence 5,000-customer scan.',
  })
  workspace(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: OpportunitiesWorkspaceQueryDto,
  ) {
    return this.getWorkspace.execute(user, query);
  }
}
