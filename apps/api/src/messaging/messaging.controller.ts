import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal, OpportunityType } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { OpportunityTypeParam } from '../action/opportunity-type.param';
import { ListCustomerMessagesQueryDto, SendOpportunityMessageDto } from './message.dto';
import { GetMessageUseCase, ListCustomerMessagesUseCase } from './get-message.use-case';
import { ListManualOutreachUseCase } from './list-manual-outreach.use-case';
import { SendManualOutreachMessageUseCase } from './send-manual-outreach-message.use-case';
import { SendOpportunityMessageUseCase } from './send-opportunity-message.use-case';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller()
export class MessagingController {
  constructor(
    private readonly sendMessage: SendOpportunityMessageUseCase,
    private readonly sendManualOutreach: SendManualOutreachMessageUseCase,
    private readonly getMessage: GetMessageUseCase,
    private readonly listCustomerMessages: ListCustomerMessagesUseCase,
    private readonly listManualOutreach: ListManualOutreachUseCase,
  ) {}

  @Post('intelligence/opportunities/:opportunityType/customers/:customerId/messages')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original message request. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Queue a durable one-to-one customer message for a currently derived opportunity. Does not send through Bale, complete the Action, or create a visit.',
  })
  send(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('opportunityType', OpportunityTypeParam) opportunityType: OpportunityType,
    @Param('customerId', UuidParam) customerId: string,
    @Body() body: SendOpportunityMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.sendMessage.execute(
      user,
      customerId,
      opportunityType,
      body.text,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('customers/:customerId/messages')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original message request. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Queue a durable one-to-one manual outreach message. Does not send through Bale, create an Opportunity, or create a visit.',
  })
  sendManual(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Body() body: SendOpportunityMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.sendManualOutreach.execute(
      user,
      customerId,
      body.text,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('messages/manual-outreach')
  @ApiOperation({
    summary:
      'List this Tehran-day manual outreach MessageRequests for the authenticated salon. Status is the durable request lifecycle, including DISPATCHED.',
  })
  listManual(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListCustomerMessagesQueryDto,
  ) {
    return this.listManualOutreach.execute(user, query);
  }

  @Get('messages/:id')
  @ApiOperation({ summary: 'Get one queued message request for the authenticated salon' })
  get(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.getMessage.execute(user, id);
  }

  @Get('customers/:customerId/messages')
  @ApiOperation({ summary: 'List message requests for one customer, newest first' })
  listForCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListCustomerMessagesQueryDto,
  ) {
    return this.listCustomerMessages.execute(user, customerId, query);
  }
}
