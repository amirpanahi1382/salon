import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal, PlatformAdminPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import {
  ArriveVisitIntentionDto,
  CreateAdminVipVisitIntentionDto,
  CreateCustomerVisitIntentionDto,
  CreateSalonVipVisitIntentionDto,
  LinkVisitIntentionDto,
  ListVisitIntentionsQueryDto,
  UpdateVisitIntentionDto,
} from './visit-intention.dto';
import {
  AdminCreateCustomerVisitIntentionUseCase,
  AdminCreateVipVisitIntentionUseCase,
  AdminUpdateVisitIntentionUseCase,
  ArriveVisitIntentionUseCase,
  CreateCustomerVisitIntentionUseCase,
  CreateSalonVipVisitIntentionUseCase,
  LinkVisitIntentionUseCase,
  ListCustomerVisitIntentionsUseCase,
  ListFollowUpsUseCase,
  ListSalonVipVisitIntentionsUseCase,
  UpdateVisitIntentionUseCase,
} from './visit-intention.use-cases';

@ApiTags('visit-intentions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller()
export class VisitIntentionController {
  constructor(
    private readonly createCustomer: CreateCustomerVisitIntentionUseCase,
    private readonly createVip: CreateSalonVipVisitIntentionUseCase,
    private readonly listVip: ListSalonVipVisitIntentionsUseCase,
    private readonly updateIntention: UpdateVisitIntentionUseCase,
    private readonly listForCustomer: ListCustomerVisitIntentionsUseCase,
    private readonly followUps: ListFollowUpsUseCase,
    private readonly arrive: ArriveVisitIntentionUseCase,
    private readonly linkVisit: LinkVisitIntentionUseCase,
  ) {}

  @Get('follow-ups/customers')
  @ApiOperation({
    summary:
      'Operational customer follow-ups: open ReturnCommitments and open customer visit intentions. Counts stay separate from VIP. Unknown time is not overdue.',
  })
  customerFollowUps(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListVisitIntentionsQueryDto,
  ) {
    return this.followUps.customers(user, query);
  }

  @Get('follow-ups/vip')
  @ApiOperation({
    summary:
      'Operational VIP visit intentions for this salon. Target-list phone and name are omitted unless the prospect supplied them to the salon.',
  })
  vipFollowUps(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListVisitIntentionsQueryDto,
  ) {
    return this.followUps.vip(user, query);
  }

  @Get('customers/:customerId/visit-intentions')
  @ApiOperation({ summary: 'Reported visit intentions for one customer. Not visits and not return commitments.' })
  listCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListVisitIntentionsQueryDto,
  ) {
    return this.listForCustomer.execute(user, customerId, query);
  }

  @Post('customers/:customerId/visit-intentions')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Record that this customer intends to visit. Does not require a SENT message and does not create a ReturnCommitment or Visit.',
  })
  createForCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Body() body: CreateCustomerVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createCustomer.execute(user, customerId, body, idempotencyKey);
  }

  @Post('vip/requests/:vipRequestId/visit-intentions')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Record an inbound VIP prospect intention. Does not copy the target list and does not create a Customer or Visit.',
  })
  createForVip(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('vipRequestId', UuidParam) vipRequestId: string,
    @Body() body: CreateSalonVipVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createVip.execute(user, vipRequestId, body, idempotencyKey);
  }

  @Get('vip/requests/:vipRequestId/visit-intentions')
  @ApiOperation({
    summary:
      'Salon-safe VIP intentions for one request. Withheld rows omit contact details and never include the recipient id.',
  })
  listForVip(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('vipRequestId', UuidParam) vipRequestId: string,
    @Query() query: ListVisitIntentionsQueryDto,
  ) {
    return this.listVip.execute(user, vipRequestId, query);
  }

  @Patch('visit-intentions/:id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Correct the agreed time. The original reporter, source, and report time stay in place.' })
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: UpdateVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.updateIntention.execute(user, id, body, idempotencyKey);
  }

  @Post('visit-intentions/:id/arrive')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Record a Visit with the existing visit writer and explicitly link this intention in the same transaction. STAFF cannot record a sale.',
  })
  arriveNow(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: ArriveVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.arrive.execute(user, id, body, idempotencyKey);
  }

  @Post('visit-intentions/:id/link-visit')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Explicitly link an existing same-salon Visit. Independent visit creation does not do this.',
  })
  link(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: LinkVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.linkVisit.execute(user, id, body, idempotencyKey);
  }
}

@ApiTags('admin-visit-intentions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminVisitIntentionController {
  constructor(
    private readonly createCustomer: AdminCreateCustomerVisitIntentionUseCase,
    private readonly createVip: AdminCreateVipVisitIntentionUseCase,
    private readonly updateIntention: AdminUpdateVisitIntentionUseCase,
  ) {}

  @Post('customers/:customerId/visit-intentions')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Record a customer visit intention reported to Platform Admin. Does not fabricate a SENT message or a ReturnCommitment.',
  })
  createForCustomer(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Body() body: CreateCustomerVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createCustomer.execute(admin, customerId, body, idempotencyKey);
  }

  @Post('vip-requests/:vipRequestId/recipients/:recipientId/visit-intentions')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Record a VIP intention reported during manual handling. This is not message delivery. Salon reads stay privacy-safe.',
  })
  createForVip(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('vipRequestId', UuidParam) vipRequestId: string,
    @Param('recipientId', UuidParam) recipientId: string,
    @Body() body: CreateAdminVipVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createVip.execute(admin, vipRequestId, recipientId, body, idempotencyKey);
  }

  @Patch('visit-intentions/:id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Correct the agreed time without changing the original reporter or VIP recipient.' })
  update(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: UpdateVisitIntentionDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.updateIntention.execute(admin, id, body, idempotencyKey);
  }
}
