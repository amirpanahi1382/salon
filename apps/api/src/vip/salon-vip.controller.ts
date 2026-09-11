import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { VIP_SAMPLE_WORK_FIELD, VIP_SAMPLE_WORK_MAX_BYTES } from './vip.constants';
import { CreateVipRequestDto } from './vip.dto';
import {
  CreateVipRequestUseCase,
  DownloadVipSampleWorkUseCase,
  GetSalonVipRequestUseCase,
  GetVipCapabilityUseCase,
  ListActiveVipListsUseCase,
  SubmitVipRequestUseCase,
  UploadVipSampleWorkUseCase,
} from './vip.use-cases';

@ApiTags('vip')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'STAFF')
@Controller('vip')
export class SalonVipController {
  constructor(
    private readonly capability: GetVipCapabilityUseCase,
    private readonly lists: ListActiveVipListsUseCase,
    private readonly createRequest: CreateVipRequestUseCase,
    private readonly getRequest: GetSalonVipRequestUseCase,
    private readonly uploadSample: UploadVipSampleWorkUseCase,
    private readonly submitRequest: SubmitVipRequestUseCase,
    private readonly downloadImage: DownloadVipSampleWorkUseCase,
  ) {}

  @Get('capability')
  @ApiOperation({ summary: 'VIP entitlement, remaining 14-day quota, and current request' })
  getCapability(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.capability.execute(user);
  }

  @Get('lists')
  @ApiOperation({ summary: 'Active VIP target lists available for reservation' })
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.lists.execute(user);
  }

  @Post('requests')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Reserve one ACTIVE VIP list and consume rolling 14-day quota' })
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: CreateVipRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.createRequest.execute(user, body, requireIdempotencyKey(idempotencyKey));
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Get this salon’s VIP request' })
  get(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.getRequest.execute(user, id);
  }

  @Post('requests/:id/sample-works')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor(VIP_SAMPLE_WORK_FIELD, {
      storage: memoryStorage(),
      limits: { fileSize: VIP_SAMPLE_WORK_MAX_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload one sample-work image (max 3 per request)' })
  upload(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.uploadSample.execute(
      user,
      id,
      {
        buffer: file?.buffer ?? Buffer.alloc(0),
        originalname: file?.originalname ?? '',
        size: file?.size ?? 0,
      },
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('requests/:id/submit')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Submit the reserved VIP request after sample-work upload' })
  submit(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.submitRequest.execute(user, id, requireIdempotencyKey(idempotencyKey));
  }

  @Get('sample-works/:id')
  @ApiOperation({ summary: 'Download this salon’s sample-work image' })
  async image(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    const file = await this.downloadImage.executeForSalon(user, id);
    return new StreamableFile(file.body, { type: file.contentType });
  }
}
