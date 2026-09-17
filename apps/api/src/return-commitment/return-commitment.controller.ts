import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { ArriveReturnCommitmentUseCase } from './arrive-return-commitment.use-case';
import { CreateReturnCommitmentUseCase } from './create-return-commitment.use-case';
import { LinkReturnCommitmentVisitUseCase } from './link-return-commitment-visit.use-case';
import {
  ListCustomerReturnCommitmentsUseCase,
  ListUpcomingReturnCommitmentsUseCase,
} from './list-return-commitments.use-case';
import { UpdateReturnCommitmentUseCase } from './update-return-commitment.use-case';
import {
  ArriveReturnCommitmentDto,
  CreateReturnCommitmentDto,
  LinkReturnCommitmentVisitDto,
  ListReturnCommitmentsQueryDto,
  ListUpcomingReturnCommitmentsQueryDto,
  UpdateReturnCommitmentDto,
} from './return-commitment.dto';

@ApiTags('return-commitments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller()
export class ReturnCommitmentController {
  constructor(
    private readonly createReturnCommitment: CreateReturnCommitmentUseCase,
    private readonly updateReturnCommitment: UpdateReturnCommitmentUseCase,
    private readonly arriveReturnCommitment: ArriveReturnCommitmentUseCase,
    private readonly linkReturnCommitmentVisit: LinkReturnCommitmentVisitUseCase,
    private readonly listCustomerReturnCommitments: ListCustomerReturnCommitmentsUseCase,
    private readonly listUpcomingReturnCommitments: ListUpcomingReturnCommitmentsUseCase,
  ) {}

  @Get('return-commitments/upcoming')
  @ApiOperation({
    summary:
      'List upcoming product-originated return commitments for promotion context. Informational only; not availability, occupancy, or booking.',
  })
  listUpcoming(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListUpcomingReturnCommitmentsQueryDto,
  ) {
    return this.listUpcomingReturnCommitments.execute(user, query);
  }

  @Get('customers/:customerId/return-commitments')
  @ApiOperation({
    summary: 'List product-originated return commitments for one customer. Not visits.',
  })
  listForCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListReturnCommitmentsQueryDto,
  ) {
    return this.listCustomerReturnCommitments.execute(user, customerId, query);
  }

  @Post('messages/:messageRequestId/return-commitments')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original return commitment. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Record that the customer agreed to return after this SENT product outreach. Not an appointment and not a Visit.',
  })
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('messageRequestId', UuidParam) messageRequestId: string,
    @Body() body: CreateReturnCommitmentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createReturnCommitment.execute(user, messageRequestId, body, idempotencyKey);
  }

  @Patch('return-commitments/:id')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the patched return commitment. Same key and different payload returns 409. Concurrent edits still require a matching updatedAt token.',
  })
  @ApiOperation({
    summary: 'Reschedule the agreed return time on the same ReturnCommitment. Does not create a second row.',
  })
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: UpdateReturnCommitmentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.updateReturnCommitment.execute(user, id, body, idempotencyKey);
  }

  @Post('return-commitments/:id/arrive')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original arrival. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Record that the customer actually arrived and create an authoritative completed Visit linked to this ReturnCommitment. Not a booking check-in.',
  })
  arrive(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: ArriveReturnCommitmentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.arriveReturnCommitment.execute(user, id, body, idempotencyKey);
  }

  @Post('return-commitments/:id/link-visit')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original link. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Explicitly link an existing completed Visit to this open ReturnCommitment. Never infers by timestamp.',
  })
  linkVisit(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: LinkReturnCommitmentVisitDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.linkReturnCommitmentVisit.execute(user, id, body, idempotencyKey);
  }
}
