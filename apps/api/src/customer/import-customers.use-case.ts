import { Injectable } from '@nestjs/common';
import {
  ValidationError,
  createId,
  DOMAIN_EVENT_TYPES,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CustomerRepository } from './customer.repository';
import {
  CUSTOMER_IMPORT_MAX_FILE_BYTES,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_IMPORT_TX_TIMEOUT_MS,
  CUSTOMER_IMPORT_WRITE_CHUNK,
} from './customer-import.constants';
import type { CustomerImportResultDto, CustomerImportRowResultDto } from './customer.dto';
import {
  assertXlsxBuffer,
  parseCustomerExcel,
  type ParsedCustomerExcelRow,
} from './parse-customer-excel';

export type UploadedCustomerExcel = {
  buffer: Buffer;
  originalname: string;
  size: number;
};

@Injectable()
export class ImportCustomersUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, file: UploadedCustomerExcel): Promise<CustomerImportResultDto> {
    if (!file?.buffer?.length) {
      throw new ValidationError('Upload an Excel .xlsx file');
    }
    if (file.size > CUSTOMER_IMPORT_MAX_FILE_BYTES || file.buffer.length > CUSTOMER_IMPORT_MAX_FILE_BYTES) {
      throw new ValidationError(`The Excel file is too large. Maximum size is ${CUSTOMER_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB.`);
    }

    try {
      assertXlsxBuffer(file.buffer, file.originalname || 'upload.xlsx');
    } catch {
      throw new ValidationError('Only .xlsx Excel files are supported');
    }

    let parsedRows: ParsedCustomerExcelRow[];
    try {
      parsedRows = (await parseCustomerExcel(file.buffer, CUSTOMER_IMPORT_MAX_ROWS)).rows;
    } catch (error: unknown) {
      throw this.mapParseError(error);
    }

    const results: CustomerImportRowResultDto[] = [];
    const ready: Array<{
      row: number;
      id: string;
      firstName: string;
      lastName: string;
      phoneNumber: string;
    }> = [];
    const seenPhones = new Map<string, number>();

    for (const item of parsedRows) {
      if ('status' in item && item.status === 'INVALID') {
        results.push({ row: item.row, status: 'INVALID', errors: item.errors });
        continue;
      }
      if (!('phoneNumber' in item)) {
        continue;
      }
      const previous = seenPhones.get(item.phoneNumber);
      if (previous !== undefined) {
        results.push({ row: item.row, status: 'DUPLICATE_IN_FILE' });
        continue;
      }
      seenPhones.set(item.phoneNumber, item.row);
      ready.push({
        row: item.row,
        id: createId(),
        firstName: item.firstName,
        lastName: item.lastName,
        phoneNumber: item.phoneNumber,
      });
    }

    const existing = await this.customers.findPhones(
      principal.tenantId,
      ready.map((item) => item.phoneNumber),
    );
    const existingPhones = new Set(existing.map((row) => row.phoneNumber));

    const toInsert = ready.filter((item) => {
      if (existingPhones.has(item.phoneNumber)) {
        results.push({ row: item.row, status: 'ALREADY_EXISTS' });
        return false;
      }
      return true;
    });

    const now = new Date();
    const createdIds = new Set<string>();

    if (toInsert.length > 0) {
      await this.prisma.client.$transaction(
        async (tx) => {
          for (const chunk of chunkItems(toInsert, CUSTOMER_IMPORT_WRITE_CHUNK)) {
            await tx.customer.createMany({
              data: chunk.map((item) => ({
                id: item.id,
                salonId: principal.tenantId,
                firstName: item.firstName,
                lastName: item.lastName,
                phoneNumber: item.phoneNumber,
                updatedAt: now,
              })),
              skipDuplicates: true,
            });
          }

          const created: Array<{ id: string }> = [];
          for (const chunk of chunkItems(toInsert, CUSTOMER_IMPORT_WRITE_CHUNK)) {
            const rows = await tx.customer.findMany({
              where: {
                salonId: principal.tenantId,
                id: { in: chunk.map((item) => item.id) },
              },
              select: { id: true },
            });
            created.push(...rows);
          }
          for (const row of created) {
            createdIds.add(row.id);
          }

          if (created.length > 0) {
            for (const chunk of chunkItems(created, CUSTOMER_IMPORT_WRITE_CHUNK)) {
              await tx.outboxEvent.createMany({
                data: chunk.map((row) => ({
                  id: createId(),
                  tenantId: principal.tenantId,
                  eventType: DOMAIN_EVENT_TYPES.CustomerCreated,
                  payload: { customerId: row.id, salonId: principal.tenantId },
                })),
              });
            }
          }

          const imported = created.length;
          const skipped =
            results.filter(
              (row) => row.status === 'ALREADY_EXISTS' || row.status === 'DUPLICATE_IN_FILE',
            ).length + (toInsert.length - imported);
          const failed = results.filter((row) => row.status === 'INVALID').length;

          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              actorId: principal.userId,
              action: 'CUSTOMERS_IMPORTED',
              resource: 'customer',
              result: 'SUCCESS',
              metadata: {
                totalRows: parsedRows.length,
                imported,
                skipped,
                failed,
              },
            },
          });
        },
        { maxWait: 5_000, timeout: CUSTOMER_IMPORT_TX_TIMEOUT_MS },
      );
    } else {
      await this.prisma.client.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'CUSTOMERS_IMPORTED',
          resource: 'customer',
          result: 'SUCCESS',
          metadata: {
            totalRows: parsedRows.length,
            imported: 0,
            skipped: results.filter(
              (row) => row.status === 'ALREADY_EXISTS' || row.status === 'DUPLICATE_IN_FILE',
            ).length,
            failed: results.filter((row) => row.status === 'INVALID').length,
          },
        },
      });
    }

    for (const item of toInsert) {
      if (createdIds.has(item.id)) {
        results.push({ row: item.row, status: 'IMPORTED' });
      } else {
        results.push({ row: item.row, status: 'ALREADY_EXISTS' });
      }
    }

    results.sort((a, b) => a.row - b.row);

    const imported = results.filter((row) => row.status === 'IMPORTED').length;
    const skipped = results.filter(
      (row) => row.status === 'ALREADY_EXISTS' || row.status === 'DUPLICATE_IN_FILE',
    ).length;
    const failed = results.filter((row) => row.status === 'INVALID').length;

    return {
      totalRows: results.length,
      imported,
      skipped,
      failed,
      results,
    };
  }

  private mapParseError(error: unknown): ValidationError {
    const code = error instanceof Error ? error.message : '';
    switch (code) {
      case 'MISSING_HEADERS':
        return new ValidationError('The Excel file must include Name and Phone columns');
      case 'EMPTY':
        return new ValidationError('The Excel file has no customer rows');
      case 'ROW_LIMIT':
        return new ValidationError(`The Excel file has too many rows. Maximum is ${CUSTOMER_IMPORT_MAX_ROWS}`);
      case 'MALFORMED':
        return new ValidationError('The Excel file could not be read');
      case 'ZIP_BOMB':
        return new ValidationError('The Excel file is too large or too complex to import');
      case 'SHEET_LIMIT':
        return new ValidationError('The Excel file has too many worksheets');
      default:
        return new ValidationError('The Excel file could not be imported');
    }
  }
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
