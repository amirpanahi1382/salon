import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedPrincipal, PlatformAdminPrincipal } from '@salon/shared';
import { memoryStorage } from 'multer';
import { AllowOnboardingSession } from '../auth/salon-session-access';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { ManualTransferEnabledGuard } from './activation-enabled.guard';
import {
  ApproveActivationReceiptDto,
  ListActivationReceiptsQueryDto,
  RejectActivationReceiptDto,
} from './activation.dto';
import {
  DecideActivationReceiptUseCase,
  GetActivationReceiptReviewUseCase,
  GetActivationStatusUseCase,
  ListActivationReceiptsUseCase,
  ReadAdminActivationReceiptUseCase,
  ReadOwnerActivationReceiptUseCase,
  SubmitActivationReceiptUseCase,
  UploadActivationReceiptUseCase,
} from './activation.use-cases';
import { ACTIVATION_RECEIPT_MAX_BYTES } from './receipt-image';

@ApiTags('activation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
@AllowOnboardingSession()
@Controller('activation')
export class ActivationController {
  constructor(
    private readonly status: GetActivationStatusUseCase,
    private readonly upload: UploadActivationReceiptUseCase,
    private readonly submit: SubmitActivationReceiptUseCase,
    private readonly image: ReadOwnerActivationReceiptUseCase,
  ) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Server-owned payment state for an onboarding owner. A stored image is not a verified transfer.',
  })
  getStatus(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.status.execute(user);
  }

  @Post('receipts')
  @UseGuards(ManualTransferEnabledGuard)
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ACTIVATION_RECEIPT_MAX_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Store one private receipt image for the accepted contract. This does not submit it for review.',
  })
  uploadReceipt(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.upload.execute(user, {
      buffer: file?.buffer ?? Buffer.alloc(0),
      originalname: file?.originalname ?? '',
      size: file?.size ?? 0,
    });
  }

  @Get('receipts/:id/image')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Authenticated preview of this owner’s stored, unsubmitted receipt image.' })
  async preview(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
  ): Promise<StreamableFile> {
    const stored = await this.image.execute(user, id);
    return new StreamableFile(stored.body, {
      type: stored.contentType,
      disposition: 'inline',
      length: stored.body.length,
    });
  }

  @Post('receipts/:id/submit')
  @UseGuards(ManualTransferEnabledGuard)
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Submit the stored receipt for manual review. Does not verify the bank transfer or open product access.',
  })
  submitReceipt(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.submit.execute(user, id, requireIdempotencyKey(idempotencyKey));
  }
}

@ApiTags('admin-activation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/activation-receipts')
export class AdminActivationController {
  constructor(
    private readonly list: ListActivationReceiptsUseCase,
    private readonly review: GetActivationReceiptReviewUseCase,
    private readonly image: ReadAdminActivationReceiptUseCase,
    private readonly decide: DecideActivationReceiptUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Submitted receipt history (under review, approved, rejected). A photograph is not confirmed payment.',
  })
  history(@Query() query: ListActivationReceiptsQueryDto) {
    return this.list.execute(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Accepted agreement snapshot and receipt metadata for one review.' })
  detail(@Param('id', UuidParam) id: string) {
    return this.review.execute(id);
  }

  @Get(':id/image')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Authenticated, audited view of one receipt image. No public URL is issued.' })
  async imageBytes(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
  ): Promise<StreamableFile> {
    const stored = await this.image.execute(admin, id);
    return new StreamableFile(stored.body, {
      type: stored.contentType,
      disposition: 'inline',
      length: stored.body.length,
    });
  }

  @Post(':id/approve')
  @UseGuards(ManualTransferEnabledGuard)
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Record this platform admin’s manual bank attestation and set that salon to PRODUCT. A boolean flag is not accepted. Idempotent and audited.',
  })
  approve(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: ApproveActivationReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.decide.execute(
      admin,
      id,
      'APPROVE',
      requireIdempotencyKey(idempotencyKey),
      undefined,
      body.bankAttestation,
    );
  }

  @Post(':id/reject')
  @UseGuards(ManualTransferEnabledGuard)
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Reject this receipt with a reason. The salon stays AWAITING_PAYMENT and may submit a replacement.',
  })
  reject(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: RejectActivationReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.decide.execute(admin, id, 'REJECT', requireIdempotencyKey(idempotencyKey), body.reason);
  }
}
