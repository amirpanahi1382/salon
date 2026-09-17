import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { GetRecoveryOutcomesSummaryUseCase } from './get-recovery-outcomes-summary.use-case';
import { ListRecoveryOutcomeReturnsUseCase } from './list-recovery-outcome-returns.use-case';
import {
  ListRecoveryOutcomeReturnsQueryDto,
  RecoveryOutcomesQueryDto,
} from './recovery-outcomes.dto';

@ApiTags('recovery-outcomes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('recovery/outcomes')
export class RecoveryOutcomesController {
  constructor(
    private readonly getSummary: GetRecoveryOutcomesSummaryUseCase,
    private readonly listReturns: ListRecoveryOutcomeReturnsUseCase,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'EVENT-based salon recovery facts for an Asia/Tehran Saturday business week. Associated recorded revenue is not causal.',
  })
  summary(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: RecoveryOutcomesQueryDto) {
    return this.getSummary.execute(user, query);
  }

  @Get('returns')
  @ApiOperation({
    summary:
      'Paginated recovery Visits for the owner week. kind=COMMITMENT_BACKED or OBSERVED after visitId dedup.',
  })
  returns(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListRecoveryOutcomeReturnsQueryDto,
  ) {
    return this.listReturns.execute(user, query);
  }
}
