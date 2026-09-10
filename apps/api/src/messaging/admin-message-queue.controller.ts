import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformAdminPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { AdminMessageQueueQueryDto } from './admin-message.dto';
import {
  GetAdminMessageUseCase,
  ListAdminMessageQueueUseCase,
  MarkManualMessageSentUseCase,
  RetryBaleMessageUseCase,
  SelectMessageDeliveryModeUseCase,
} from './admin-message.use-cases';

@ApiTags('admin-message-queue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/message-queue')
export class AdminMessageQueueController {
  constructor(
    private readonly listQueue: ListAdminMessageQueueUseCase,
    private readonly getMessage: GetAdminMessageUseCase,
    private readonly selectMode: SelectMessageDeliveryModeUseCase,
    private readonly markManualSent: MarkManualMessageSentUseCase,
    private readonly retryBale: RetryBaleMessageUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List queued customer message requests across salons' })
  list(@Query() query: AdminMessageQueueQueryDto) {
    return this.listQueue.execute(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one queued message request for manual or Bale fulfillment' })
  get(@Param('id', UuidParam) id: string) {
    return this.getMessage.execute(id);
  }

  @Post(':id/select-bale')
  @HttpCode(201)
  @ApiOperation({ summary: 'Fulfill the request through Bale asynchronously' })
  selectBale(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
  ) {
    return this.selectMode.execute(admin, id, 'BALE');
  }

  @Post(':id/select-manual')
  @HttpCode(201)
  @ApiOperation({ summary: 'Fulfill the request through a human operator' })
  selectManual(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
  ) {
    return this.selectMode.execute(admin, id, 'MANUAL');
  }

  @Post(':id/mark-manual-sent')
  @HttpCode(201)
  @ApiOperation({ summary: 'Mark a manual delivery as sent after human confirmation' })
  markSent(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
  ) {
    return this.markManualSent.execute(admin, id);
  }

  @Post(':id/retry')
  @HttpCode(201)
  @ApiOperation({ summary: 'Activate or retry a Bale delivery when the provider is configured' })
  retry(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
  ) {
    return this.retryBale.execute(admin, id);
  }
}
