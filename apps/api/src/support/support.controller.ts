import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal, PlatformAdminPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { PostSupportMessageDto, SupportCursorQueryDto } from './support.dto';
import {
  GetAdminSupportUseCase,
  GetSalonSupportUseCase,
  ListAdminSupportUseCase,
  PostAdminSupportMessageUseCase,
  PostSalonSupportMessageUseCase,
} from './support.use-cases';

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller('support/conversation')
export class SalonSupportController {
  constructor(
    private readonly getThread: GetSalonSupportUseCase,
    private readonly postMessage: PostSalonSupportMessageUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Read the signed-in salon user support conversation and its newest messages',
  })
  get(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: SupportCursorQueryDto) {
    return this.getThread.execute(user, query.cursor);
  }

  @Post('messages')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Record a support message from the signed-in salon user. Does not contact a provider.',
  })
  post(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: PostSupportMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.postMessage.execute(user, body.text, requireIdempotencyKey(idempotencyKey));
  }
}

@ApiTags('admin-support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/support/conversations')
export class AdminSupportController {
  constructor(
    private readonly listConversations: ListAdminSupportUseCase,
    private readonly getThread: GetAdminSupportUseCase,
    private readonly postMessage: PostAdminSupportMessageUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List salon-user support conversations for Platform Admin' })
  list(@Query() query: SupportCursorQueryDto) {
    return this.listConversations.execute(query.cursor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one salon-user support conversation' })
  get(@Param('id', UuidParam) id: string, @Query() query: SupportCursorQueryDto) {
    return this.getThread.execute(id, query.cursor);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Record a Platform Admin reply in a support conversation' })
  post(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: PostSupportMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.postMessage.execute(admin, id, body.text, requireIdempotencyKey(idempotencyKey));
  }
}
