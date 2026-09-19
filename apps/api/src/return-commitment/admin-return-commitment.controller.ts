import { Body, Controller, Headers, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformAdminPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import {
  AdminCreateReturnCommitmentUseCase,
  AdminUpdateReturnCommitmentUseCase,
} from './admin-return-commitment.use-case';
import { CreateReturnCommitmentDto, UpdateReturnCommitmentDto } from './return-commitment.dto';

@ApiTags('admin-return-commitments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminReturnCommitmentController {
  constructor(
    private readonly createReturnCommitment: AdminCreateReturnCommitmentUseCase,
    private readonly updateReturnCommitment: AdminUpdateReturnCommitmentUseCase,
  ) {}

  @Post('message-queue/:messageRequestId/return-commitments')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original return commitment. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Record a canonical salon ReturnCommitment from an eligible SENT customer message. Platform admin is the actor, not the tenant owner.',
  })
  create(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('messageRequestId', UuidParam) messageRequestId: string,
    @Body() body: CreateReturnCommitmentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createReturnCommitment.execute(admin, messageRequestId, body, idempotencyKey);
  }

  @Patch('return-commitments/:id')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the patched return commitment. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary: 'Reschedule expectedAt on the canonical ReturnCommitment. Does not create a second row.',
  })
  update(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: UpdateReturnCommitmentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.updateReturnCommitment.execute(admin, id, body, idempotencyKey);
  }
}
