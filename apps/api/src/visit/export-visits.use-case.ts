import { Injectable } from '@nestjs/common';
import { createId, ValidationError, type AuthenticatedPrincipal } from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { ExportVisitsQueryDto } from './visit.dto';
import { VISIT_EXPORT_MAX_ROWS } from './visit-export.constants';
import { buildVisitsWorkbook, toVisitExportRow } from './visit-export.xlsx';
import { resolveVisitListFilters } from './list-visits.use-case';
import { VisitRepository } from './visit.repository';

@Injectable()
export class ExportVisitsUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(principal: AuthenticatedPrincipal, query: ExportVisitsQueryDto): Promise<Buffer> {
    const filters = await resolveVisitListFilters(this.customers, principal.tenantId, query);
    const rows = await this.visits.listForSalonExport(principal.tenantId, filters);
    if (rows.length > VISIT_EXPORT_MAX_ROWS) {
      throw new ValidationError(
        `Export is limited to ${VISIT_EXPORT_MAX_ROWS} visits. Narrow the date range or customer filter.`,
      );
    }

    const workbook = await buildVisitsWorkbook(rows.map(toVisitExportRow));

    await this.prisma.client.auditLog.create({
      data: {
        id: createId(),
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'VISITS_EXPORTED',
        resource: 'visit',
        result: 'SUCCESS',
        metadata: {
          rowCount: rows.length,
          hasCustomerFilter: Boolean(filters.customerId),
          hasDateFilter: Boolean(filters.from || filters.to),
          maxRows: VISIT_EXPORT_MAX_ROWS,
        },
      },
    });

    return workbook;
  }
}
