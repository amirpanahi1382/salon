import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { CreateVisitUseCase } from './create-visit.use-case';
import { CreateVisitDto } from './visit.dto';
import { GetVisitUseCase } from './get-visit.use-case';
import { ListCustomerVisitsUseCase } from './list-customer-visits.use-case';

@ApiTags('visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class VisitController {
  constructor(
    private readonly createVisit: CreateVisitUseCase,
    private readonly getVisit: GetVisitUseCase,
    private readonly listCustomerVisits: ListCustomerVisitsUseCase,
  ) {}

  @Post('visits')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({
    summary: 'Record a completed historical visit (not a booking or appointment)',
  })
  create(@CurrentUser() user: AuthenticatedPrincipal, @Body() body: CreateVisitDto) {
    return this.createVisit.execute(user, body);
  }

  @Get('visits/:id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get a completed visit in the authenticated salon' })
  getById(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.getVisit.execute(user, id);
  }

  @Get('customers/:customerId/visits')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List completed visits for a customer, newest first' })
  history(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId') customerId: string,
  ) {
    return this.listCustomerVisits.execute(user, customerId);
  }
}
