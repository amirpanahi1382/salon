import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { CompleteVisitWithSaleUseCase } from './complete-visit-with-sale.use-case';
import { CreateVisitUseCase } from './create-visit.use-case';
import { DeleteVisitUseCase } from './delete-visit.use-case';
import { ExportVisitsUseCase } from './export-visits.use-case';
import {
  CompleteVisitWithSaleDto,
  CreateVisitDto,
  ExportVisitsQueryDto,
  ListCustomerVisitsQueryDto,
  ListVisitsQueryDto,
} from './visit.dto';
import { GetVisitUseCase } from './get-visit.use-case';
import { normalizeIdempotencyKey } from './idempotency';
import { ListCustomerVisitsUseCase } from './list-customer-visits.use-case';
import { ListVisitsUseCase } from './list-visits.use-case';
import { VISIT_EXPORT_FILENAME, XLSX_CONTENT_TYPE } from './visit-export.constants';

@ApiTags('visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class VisitController {
  constructor(
    private readonly createVisit: CreateVisitUseCase,
    private readonly completeVisitWithSale: CompleteVisitWithSaleUseCase,
    private readonly getVisit: GetVisitUseCase,
    private readonly listVisits: ListVisitsUseCase,
    private readonly listCustomerVisits: ListCustomerVisitsUseCase,
    private readonly exportVisits: ExportVisitsUseCase,
    private readonly deleteVisit: DeleteVisitUseCase,
  ) {}

  @Post('visits/complete-with-sale')
  @Roles('OWNER', 'MANAGER')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. Same key and payload replay the original visit and transaction. Same key and different payload returns 409.',
  })
  @ApiOperation({
    summary:
      'Record a completed visit and its COMPLETED sale atomically (Visit + Transaction + TransactionItem). Not a booking.',
  })
  completeWithSale(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: CompleteVisitWithSaleDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.completeVisitWithSale.execute(user, body, idempotencyKey);
  }

  @Post('visits')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Opaque 8-128 character key scoped to the authenticated user and salon. Retries with the same key and same customerId+visitedAt return the original visit. The same key with a different payload returns 409. Optional for backward compatibility; the Flutter client always sends it.',
  })
  @ApiOperation({
    summary: 'Record a completed historical visit (not a booking or appointment)',
  })
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: CreateVisitDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.createVisit.execute(user, body, normalizeIdempotencyKey(idempotencyKey));
  }

  @Get('visits')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({
    summary: 'List completed visits for the authenticated salon, newest first',
  })
  list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ListVisitsQueryDto) {
    return this.listVisits.execute(user, query);
  }

  @Get('visits/export')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${VISIT_EXPORT_FILENAME}"`)
  @ApiOperation({
    summary:
      'Export matching completed visit events as a Persian RTL Excel file. Uses the same tenant scope and filters as GET /visits. Maximum 5000 rows.',
  })
  async export(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ExportVisitsQueryDto) {
    const buffer = await this.exportVisits.execute(user, query);
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${VISIT_EXPORT_FILENAME}"`,
    });
  }

  @Get('visits/:id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get a completed visit in the authenticated salon' })
  getById(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.getVisit.execute(user, id);
  }

  @Delete('visits/:id')
  @HttpCode(204)
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Delete a completed visit in the authenticated salon' })
  remove(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.deleteVisit.execute(user, id);
  }

  @Get('customers/:customerId/visits')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List completed visits for a customer, newest first' })
  history(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', UuidParam) customerId: string,
    @Query() query: ListCustomerVisitsQueryDto,
  ) {
    return this.listCustomerVisits.execute(user, customerId, query.cursor);
  }
}
