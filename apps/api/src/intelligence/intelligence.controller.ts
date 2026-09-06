import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { GetCustomerIntelligenceUseCase } from './get-customer-intelligence.use-case';
import { GetIntelligenceSummaryUseCase } from './get-intelligence-summary.use-case';
import { IntelligenceQueryDto } from './intelligence.dto';
import { ListCustomerSegmentsUseCase } from './list-customer-segments.use-case';
import { ListOpportunitiesUseCase } from './list-opportunities.use-case';

@ApiTags('intelligence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly getCustomerIntelligence: GetCustomerIntelligenceUseCase,
    private readonly listOpportunities: ListOpportunitiesUseCase,
    private readonly listSegments: ListCustomerSegmentsUseCase,
    private readonly getSummary: GetIntelligenceSummaryUseCase,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Visit-based status counts plus completed-transaction revenue (UTC calendar)',
  })
  summary(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.getSummary.execute(user);
  }

  @Get('opportunities')
  @ApiOperation({
    summary: 'Customers who need attention, with an explainable recommended action',
  })
  opportunities(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: IntelligenceQueryDto,
  ) {
    return this.listOpportunities.execute(user, query.type, query.cursor);
  }

  @Get('segments')
  @ApiOperation({ summary: 'Derived customer status segments from completed visits' })
  segments(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: IntelligenceQueryDto,
  ) {
    return this.listSegments.execute(user, query.status, query.cursor);
  }

  @Get('customers/:customerId')
  @ApiOperation({
    summary: 'Visit-based behavior plus completed-transaction revenue metrics for one customer',
  })
  customer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
  ) {
    return this.getCustomerIntelligence.execute(user, customerId);
  }
}
