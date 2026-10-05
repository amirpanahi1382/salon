import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformAdminPrincipal } from '@salon/shared';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import {
  VIP_IMPORT_FIELD,
  VIP_IMPORT_MAX_FILE_BYTES,
  XLSX_CONTENT_TYPE,
} from './vip.constants';
import { AdminVipListsQueryDto, GrantVipEntitlementDto, ListCursorQueryDto, PatchVipListDto, AdminVipOutreachSalonsQueryDto, ListAdminSalonsQueryDto } from './vip.dto';
import { buildVipImportTemplate } from './parse-vip-excel';
import {
  GetAdminVipOutreachRequestUseCase,
  GetAdminVipOutreachSalonUseCase,
  ListAdminVipOutreachSalonsUseCase,
} from './admin-vip-outreach.use-cases';
import {
  DeleteVipListUseCase,
  DispatchVipRequestUseCase,
  DownloadVipSampleWorkUseCase,
  ExportVipRequestExcelUseCase,
  GetVipListUseCase,
  GrantVipEntitlementUseCase,
  ImportVipListUseCase,
  ListAdminSalonsUseCase,
  ListVipListsUseCase,
  PatchVipListUseCase,
  RevokeVipEntitlementUseCase,
} from './vip.use-cases';

@ApiTags('admin-vip')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/vip')
export class AdminVipController {
  constructor(
    private readonly importList: ImportVipListUseCase,
    private readonly listLists: ListVipListsUseCase,
    private readonly getList: GetVipListUseCase,
    private readonly patchList: PatchVipListUseCase,
    private readonly deleteList: DeleteVipListUseCase,
    private readonly grantEntitlement: GrantVipEntitlementUseCase,
    private readonly revokeEntitlement: RevokeVipEntitlementUseCase,
    private readonly listSalons: ListAdminSalonsUseCase,
    private readonly exportRequest: ExportVipRequestExcelUseCase,
    private readonly downloadImage: DownloadVipSampleWorkUseCase,
    private readonly dispatchRequest: DispatchVipRequestUseCase,
    private readonly outreachSalons: ListAdminVipOutreachSalonsUseCase,
    private readonly outreachSalon: GetAdminVipOutreachSalonUseCase,
    private readonly outreachRequest: GetAdminVipOutreachRequestUseCase,
  ) {}

  @Get('outreach/salons')
  @ApiOperation({
    summary:
      'Derived admin VIP folders grouped by salonId. Not a persisted folder entity. Cursor is latestActivityAt DESC, salonId DESC.',
  })
  listOutreachSalons(@Query() query: AdminVipOutreachSalonsQueryDto) {
    return this.outreachSalons.execute(query);
  }

  @Get('outreach/salons/:salonId')
  @ApiOperation({ summary: 'VIP requests for one salon folder, newest first, cursor paginated' })
  getOutreachSalon(
    @Param('salonId', UuidParam) salonId: string,
    @Query() query: ListCursorQueryDto,
  ) {
    return this.outreachSalon.execute(salonId, query.cursor);
  }

  @Get('outreach/requests/:id')
  @ApiOperation({ summary: 'One VIP request with paginated recipient execution state' })
  getOutreachRequest(
    @Param('id', UuidParam) id: string,
    @Query() query: ListCursorQueryDto,
  ) {
    return this.outreachRequest.execute(id, query.cursor);
  }

  @Get('lists/import/template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @ApiOperation({ summary: 'Download the VIP list Excel template' })
  async template() {
    const buffer = await buildVipImportTemplate();
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: 'attachment; filename="vip-import-template.xlsx"',
    });
  }

  @Post('lists/import')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor(VIP_IMPORT_FIELD, {
      storage: memoryStorage(),
      limits: { fileSize: VIP_IMPORT_MAX_FILE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import a VIP target list from Excel. Phone required; name optional. Rejects more than 100 rows.' })
  import(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @UploadedFile() file: Express.Multer.File,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.importList.execute(admin, {
      buffer: file?.buffer ?? Buffer.alloc(0),
      originalname: file?.originalname ?? '',
      size: file?.size ?? 0,
    }, requireIdempotencyKey(idempotencyKey));
  }

  @Get('lists')
  @ApiOperation({
    summary:
      'List platform VIP target lists. Omitted catalogMembership returns every list. ORIGINAL_TEHRAN filters that reviewed collection before pagination.',
  })
  list(@Query() query: AdminVipListsQueryDto) {
    return this.listLists.execute(query.cursor, query.catalogMembership);
  }

  @Get('lists/:id')
  @ApiOperation({ summary: 'Get one VIP target list and its current request if submitted' })
  get(@Param('id', UuidParam) id: string) {
    return this.getList.execute(id);
  }

  @Patch('lists/:id')
  @ApiOperation({ summary: 'Rename or activate/deactivate a VIP target list' })
  patch(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: PatchVipListDto,
  ) {
    return this.patchList.execute(admin, id, body);
  }

  @Delete('lists/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a VIP list that has no request history' })
  remove(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
  ) {
    return this.deleteList.execute(admin, id);
  }

  @Get('salons')
  @ApiOperation({ summary: 'List salons and VIP entitlement state' })
  salons(@Query() query: ListAdminSalonsQueryDto) {
    return this.listSalons.execute(query);
  }

  @Post('entitlements')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Grant VIP outreach entitlement to a salon' })
  grant(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Body() body: GrantVipEntitlementDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.grantEntitlement.execute(admin, body.salonId, requireIdempotencyKey(idempotencyKey));
  }

  @Delete('entitlements/:salonId')
  @HttpCode(204)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Revoke VIP outreach entitlement' })
  revoke(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('salonId', UuidParam) salonId: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.revokeEntitlement.execute(admin, salonId, requireIdempotencyKey(idempotencyKey));
  }

  @Get('requests/:id/export')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @ApiOperation({ summary: 'Export VIP request contacts and generated templates' })
  async export(@Param('id', UuidParam) id: string) {
    const { buffer, filename } = await this.exportRequest.execute(id);
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('sample-works/:id')
  @ApiOperation({ summary: 'Download one VIP sample-work image' })
  async image(@Param('id', UuidParam) id: string) {
    const file = await this.downloadImage.executeForAdmin(id);
    return new StreamableFile(file.body, { type: file.contentType });
  }

  @Post('requests/:id/dispatch-manual')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Queue VIP recipients as MessageRequests for the existing admin queue' })
  dispatchManual(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.dispatchRequest.execute(admin, id, 'MANUAL', requireIdempotencyKey(idempotencyKey));
  }

  @Post('requests/:id/dispatch-bale')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Record Bale as the intended VIP dispatch mode without calling Safir (not implemented)',
  })
  dispatchBale(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.dispatchRequest.execute(admin, id, 'BALE', requireIdempotencyKey(idempotencyKey));
  }
}
