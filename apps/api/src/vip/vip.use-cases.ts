import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  DOMAIN_EVENT_TYPES,
  ForbiddenError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
  VIP_CATALOG_MEMBERSHIPS,
  VIP_LIST_MAX_CONTACTS,
  VIP_RESERVATION_EXPIRED_MESSAGE,
  VIP_LIST_NAME_MAX_LENGTH,
  VIP_MAX_SAMPLE_WORKS,
  VIP_MIN_SAMPLE_WORKS,
  VIP_ALLOWED_REQUEST_COUNTS,
  VIP_ONE_ACTIVE_DRAFT_MESSAGE,
  VIP_QUOTA_MAX,
  VIP_QUOTA_EXCEEDED_MESSAGE,
  VIP_QUOTA_WINDOW_DAYS,
  createId,
  isUsableCustomerPhone,
  isVipRegionCode,
  renderVipMessageTemplate,
  vipRegionName,
  type AuthenticatedPrincipal,
  type PlatformAdminPrincipal,
  type VipCatalogMembership,
} from '@salon/shared';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import type { ListAdminSalonsQueryDto } from './vip.dto';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { OBJECT_STORAGE, type ObjectStorage } from '../infrastructure/storage/object-storage';
import { Inject } from '@nestjs/common';
import { assertXlsxBuffer } from '../customer/parse-customer-excel';
import { messageBusinessDateValue } from '@salon/shared';
import {
  VIP_DISPATCH_BALE_OPERATION,
  VIP_DISPATCH_MANUAL_OPERATION,
  VIP_DISPATCH_TX_TIMEOUT_MS,
  VIP_ENTITLEMENT_GRANT_OPERATION,
  VIP_ENTITLEMENT_REVOKE_OPERATION,
  VIP_EXPORT_FILENAME,
  VIP_EXPORT_HEADERS,
  VIP_EXPORT_SHEET_NAME,
  VIP_IMPORT_MAX_FILE_BYTES,
  VIP_IMPORT_TX_TIMEOUT_MS,
  VIP_LIST_IMPORT_OPERATION,
  VIP_REQUEST_CREATE_OPERATION,
  VIP_REQUEST_SUBMIT_OPERATION,
  VIP_SAMPLE_WORK_MAX_BYTES,
  VIP_SAMPLE_WORK_UPLOAD_OPERATION,
} from './vip.constants';
import {
  vipDispatchHash,
  vipEntitlementHash,
  vipListImportHash,
  vipRequestCreateHash,
  vipRequestSubmitHash,
  vipSampleWorkHash,
} from './vip-idempotency';
import { detectVipImageContentType, assertSafeObjectFileName } from './image-signature';
import { parseVipTargetExcel } from './parse-vip-excel';
import { toListSummary, toVipRequest } from './vip.mapper';
import { VipRepository } from './vip.repository';
import { readVerifiedVipSampleObject } from './vip-sample-work-integrity';
import type { CreateVipRequestDto, PatchVipListDto } from './vip.dto';
import ExcelJS from 'exceljs';

function mapImportError(error: unknown): ValidationError {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'ROW_LIMIT':
      return new ValidationError(`VIP lists cannot contain more than ${VIP_LIST_MAX_CONTACTS} contacts`);
    case 'MISSING_HEADERS':
      return new ValidationError('Excel must include a شماره تلفن column');
    case 'EMPTY':
      return new ValidationError('Excel has no valid VIP contacts');
    case 'INVALID_PHONE':
      return new ValidationError('Excel contains an invalid phone number');
    case 'INVALID_ROW':
      return new ValidationError('Excel contains an invalid name or phone');
    case 'SHEET_LIMIT':
      return new ValidationError('Excel has too many worksheets');
    case 'MALFORMED':
    case 'ZIP_BOMB':
    case 'UNSUPPORTED_TYPE':
      return new ValidationError('Only a valid .xlsx Excel file is supported');
    default:
      return new ValidationError('The Excel file could not be imported');
  }
}

function sanitizeGeo(raw: string): string {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new ValidationError('محدوده سالن is invalid');
  }
  return value;
}

function excelSafeText(value: string | null | undefined): string {
  const text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

async function replayOrClaim(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    resourceType: string;
    resourceId: string;
  },
): Promise<'inserted' | { resourceId: string }> {
  const claim = await claimIdempotencyKey(tx, {
    id: createId(),
    ...input,
  });
  if (claim.inserted) {
    return 'inserted';
  }
  const existing = await findIdempotencyRecord(tx, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    operation: input.operation,
    key: input.key,
  });
  if (!existing) {
    throw new NotFoundError('Request not found');
  }
  assertSameIdempotentRequest(existing.requestHash, input.requestHash);
  return { resourceId: existing.resourceId };
}

@Injectable()
export class ImportVipListUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vip: VipRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    file: { buffer: Buffer; originalname: string; size: number },
    idempotencyKey: string,
  ) {
    if (!file?.buffer?.length) {
      throw new ValidationError('Upload an Excel .xlsx file');
    }
    if (file.size > VIP_IMPORT_MAX_FILE_BYTES || file.buffer.length > VIP_IMPORT_MAX_FILE_BYTES) {
      throw new ValidationError(
        `The Excel file is too large. Maximum size is ${VIP_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    try {
      assertXlsxBuffer(file.buffer, file.originalname || 'upload.xlsx');
    } catch {
      throw new ValidationError('Only .xlsx Excel files are supported');
    }
    let contacts: Awaited<ReturnType<typeof parseVipTargetExcel>>;
    try {
      contacts = await parseVipTargetExcel(file.buffer);
    } catch (error: unknown) {
      throw mapImportError(error);
    }
    const fingerprint = createHash('sha256')
      .update(contacts.map((row) => `${row.phoneNumber}:${row.displayName ?? ''}`).join('|'))
      .digest('hex');
    const requestHash = vipListImportHash(contacts.length, fingerprint);
    const listId = createId();
    const now = new Date();
    const name = `لیست VIP ${now.toISOString().slice(0, 16).replace('T', ' ')}`.slice(
      0,
      VIP_LIST_NAME_MAX_LENGTH,
    );

    try {
      await this.prisma.client.$transaction(
        async (tx) => {
          const claimed = await replayOrClaim(tx, {
            tenantId: admin.adminId,
            actorId: admin.adminId,
            operation: VIP_LIST_IMPORT_OPERATION,
            key: idempotencyKey,
            requestHash,
            resourceType: 'vip_target_list',
            resourceId: listId,
          });
          if (claimed !== 'inserted') {
            return;
          }
          await tx.vipTargetList.create({
            data: {
              id: listId,
              name,
              status: 'PENDING',
              contactCount: contacts.length,
              createdByAdminId: admin.adminId,
              updatedAt: now,
              contacts: {
                create: contacts.map((row, index) => ({
                  id: createId(),
                  sortOrder: index + 1,
                  displayName: row.displayName,
                  phoneNumber: row.phoneNumber,
                })),
              },
            },
          });
          await tx.auditLog.create({
            data: {
              id: createId(),
              actorId: admin.adminId,
              action: 'VIP_LIST_CREATED',
              resource: 'vip_target_list',
              resourceId: listId,
              result: 'SUCCESS',
              metadata: { contactCount: contacts.length },
            },
          });
        },
        { timeout: VIP_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }

    const existing = await this.prisma.client.idempotencyRecord.findUnique({
      where: {
        tenantId_actorId_operation_key: {
          tenantId: admin.adminId,
          actorId: admin.adminId,
          operation: VIP_LIST_IMPORT_OPERATION,
          key: idempotencyKey,
        },
      },
    });
    const id = existing?.resourceId ?? listId;
    const list = await this.vip.findListById(id);
    if (!list) {
      throw new NotFoundError('VIP list not found');
    }
    return toListSummary(list);
  }
}

const ADMIN_VIP_LIST_PAGE_SIZE = 50;

@Injectable()
export class ListVipListsUseCase {
  constructor(private readonly vip: VipRepository) {}

  async execute(cursor?: string, catalogMembership?: VipCatalogMembership) {
    if (catalogMembership && !VIP_CATALOG_MEMBERSHIPS.includes(catalogMembership)) {
      throw new ValidationError('Invalid catalog membership');
    }
    const parsed = parseAdminVipListCursor(cursor, catalogMembership);
    const [rows, summary] = await Promise.all([
      this.vip.listLists({
        cursor: parsed,
        catalogMembership,
        take: ADMIN_VIP_LIST_PAGE_SIZE + 1,
      }),
      this.vip.summarizeLists(catalogMembership),
    ]);
    const page = toListPage(rows, ADMIN_VIP_LIST_PAGE_SIZE, (row) =>
      encodeAdminVipListCursor(row, catalogMembership),
    );
    return {
      items: page.items.map(toListSummary),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      listCount: summary.listCount,
      contactRowCount: summary.contactRowCount,
      recordedContactCount: summary.recordedContactCount,
    };
  }
}

function parseAdminVipListCursor(
  cursor: string | undefined,
  catalogMembership?: VipCatalogMembership,
): { createdAt: Date; id: string } | undefined {
  if (catalogMembership) {
    const decoded = decodeCursor(cursor, 3);
    if (!decoded) return undefined;
    if (decoded[0] !== catalogMembership) throw new ValidationError('Invalid cursor');
    return { createdAt: parseCursorInstant(decoded[1]!), id: parseCursorUuid(decoded[2]!) };
  }
  const decoded = decodeCursor(cursor, 2);
  if (!decoded) return undefined;
  return { createdAt: parseCursorInstant(decoded[0]!), id: parseCursorUuid(decoded[1]!) };
}

function encodeAdminVipListCursor(
  row: { createdAt: Date; id: string },
  catalogMembership?: VipCatalogMembership,
): string {
  const parts = catalogMembership
    ? [catalogMembership, row.createdAt.toISOString(), row.id]
    : [row.createdAt.toISOString(), row.id];
  return encodeCursor(parts);
}

@Injectable()
export class GetVipListUseCase {
  constructor(private readonly vip: VipRepository) {}

  async execute(id: string) {
    const list = await this.vip.findListById(id);
    if (!list) {
      throw new NotFoundError('VIP list not found');
    }
    const contacts = await this.vip.listContacts(id);
    const latestRequest = await this.vip.client.vipRequest.findFirst({
      where: { listId: id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        salon: { select: { name: true } },
        list: { select: { name: true } },
        sampleWorks: { orderBy: { position: 'asc' } },
      },
    });
    return {
      ...toListSummary(list),
      contacts: contacts.map((row) => ({
        displayName: row.displayName,
        phoneNumber: row.phoneNumber,
        sortOrder: row.sortOrder,
      })),
      request: latestRequest ? toVipRequest(latestRequest) : null,
    };
  }
}

@Injectable()
export class PatchVipListUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vip: VipRepository,
  ) {}

  async execute(admin: PlatformAdminPrincipal, id: string, body: PatchVipListDto) {
    if (!body.name && !body.availability) {
      throw new ValidationError('Provide a name or availability change');
    }
    const now = new Date();
    const existing = await this.vip.findListById(id);
    if (!existing) {
      throw new NotFoundError('VIP list not found');
    }
    if (body.availability === 'ACTIVE' && existing.status === 'IN_USE') {
      throw new ConflictError('An in-use VIP list cannot be activated again until it is released');
    }
    if (body.availability === 'INACTIVE' && existing.status === 'IN_USE') {
      throw new ConflictError('An in-use VIP list cannot be deactivated');
    }
    if (body.availability === 'ACTIVE' && existing.status !== 'PENDING' && existing.status !== 'INACTIVE' && existing.status !== 'ACTIVE') {
      throw new ConflictError('This VIP list cannot be activated');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.vipTargetList.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.availability === 'ACTIVE' ? { status: 'ACTIVE' } : {}),
          ...(body.availability === 'INACTIVE' ? { status: 'INACTIVE' } : {}),
          updatedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          actorId: admin.adminId,
          action: body.availability === 'ACTIVE'
            ? 'VIP_LIST_ACTIVATED'
            : body.availability === 'INACTIVE'
              ? 'VIP_LIST_DEACTIVATED'
              : 'VIP_LIST_RENAMED',
          resource: 'vip_target_list',
          resourceId: id,
          result: 'SUCCESS',
          metadata: {
            name: body.name,
            availability: body.availability,
          },
        },
      });
    });
    const list = await this.vip.findListById(id);
    if (!list) {
      throw new NotFoundError('VIP list not found');
    }
    return toListSummary(list);
  }
}

@Injectable()
export class DeleteVipListUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(admin: PlatformAdminPrincipal, id: string) {
    const list = await this.prisma.client.vipTargetList.findUnique({
      where: { id },
      include: { _count: { select: { requests: true, contacts: true } } },
    });
    if (!list) {
      throw new NotFoundError('VIP list not found');
    }
    if (list.status === 'IN_USE') {
      throw new ConflictError('An in-use VIP list cannot be deleted');
    }
    if (list._count.requests > 0) {
      throw new ConflictError('VIP lists with request history cannot be deleted');
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.vipTargetContact.deleteMany({ where: { listId: id } });
      await tx.vipTargetList.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          id: createId(),
          actorId: admin.adminId,
          action: 'VIP_LIST_DELETED',
          resource: 'vip_target_list',
          resourceId: id,
          result: 'SUCCESS',
        },
      });
    });
  }
}

@Injectable()
export class GrantVipEntitlementUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(admin: PlatformAdminPrincipal, salonId: string, idempotencyKey: string) {
    if (!/^[0-9a-f-]{36}$/i.test(salonId)) {
      throw new ValidationError('Invalid salon id');
    }
    const requestHash = vipEntitlementHash(salonId, 'grant');
    const entitlementId = createId();
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await replayOrClaim(tx, {
        tenantId: admin.adminId,
        actorId: admin.adminId,
        operation: VIP_ENTITLEMENT_GRANT_OPERATION,
        key: idempotencyKey,
        requestHash,
        resourceType: 'vip_salon_entitlement',
        resourceId: entitlementId,
      });
      if (claimed !== 'inserted') {
        return;
      }
      const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { id: true } });
      if (!salon) {
        throw new NotFoundError('Salon not found');
      }
      await tx.vipSalonEntitlement.upsert({
        where: { salonId },
        create: {
          id: entitlementId,
          salonId,
          grantedByAdminId: admin.adminId,
          grantedAt: now,
          updatedAt: now,
        },
        update: {
          grantedByAdminId: admin.adminId,
          grantedAt: now,
          revokedAt: null,
          revokedByAdminId: null,
          updatedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId: admin.adminId,
          action: 'VIP_ENTITLEMENT_GRANTED',
          resource: 'vip_salon_entitlement',
          resourceId: salonId,
          result: 'SUCCESS',
        },
      });
    });
    const row = await this.prisma.client.vipSalonEntitlement.findUnique({
      where: { salonId },
      include: { salon: { select: { name: true } } },
    });
    if (!row) {
      throw new NotFoundError('VIP entitlement not found');
    }
    return {
      salonId: row.salonId,
      salonName: row.salon.name,
      entitled: row.revokedAt === null,
      grantedAt: row.grantedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }
}

@Injectable()
export class RevokeVipEntitlementUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(admin: PlatformAdminPrincipal, salonId: string, idempotencyKey: string) {
    const requestHash = vipEntitlementHash(salonId, 'revoke');
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await replayOrClaim(tx, {
        tenantId: admin.adminId,
        actorId: admin.adminId,
        operation: VIP_ENTITLEMENT_REVOKE_OPERATION,
        key: idempotencyKey,
        requestHash,
        resourceType: 'vip_salon_entitlement',
        resourceId: salonId,
      });
      if (claimed !== 'inserted') {
        return;
      }
      const updated = await tx.vipSalonEntitlement.updateMany({
        where: { salonId, revokedAt: null },
        data: {
          revokedAt: now,
          revokedByAdminId: admin.adminId,
          updatedAt: now,
        },
      });
      if (updated.count === 0) {
        throw new NotFoundError('Active VIP entitlement not found');
      }
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId: admin.adminId,
          action: 'VIP_ENTITLEMENT_REVOKED',
          resource: 'vip_salon_entitlement',
          resourceId: salonId,
          result: 'SUCCESS',
        },
      });
    });
  }
}

@Injectable()
export class ListAdminSalonsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListAdminSalonsQueryDto) {
    const parts = decodeCursor(query.cursor, 2);
    const cursor = parts ? { createdAt: parseCursorInstant(parts[0]!), id: parseCursorUuid(parts[1]!) } : undefined;
    const q = query.q?.trim();
    const salons = await this.prisma.client.salon.findMany({
      where: {
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true,
        name: true,
        createdAt: true,
        vipEntitlement: { select: { revokedAt: true } },
      },
    });
    const page = toListPage(salons, 50, (salon) =>
      encodeCursor([salon.createdAt.toISOString(), salon.id]),
    );
    return {
      items: page.items.map((salon) => ({
        id: salon.id,
        name: salon.name,
        entitled: salon.vipEntitlement != null && salon.vipEntitlement.revokedAt === null,
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

/** Response bound for the capability summary. Not a domain quota. */
const VIP_CAPABILITY_IN_PROGRESS_LIMIT = 10;

@Injectable()
export class GetVipCapabilityUseCase {
  constructor(private readonly vip: VipRepository) {}

  async execute(principal: AuthenticatedPrincipal) {
    const entitled = (await this.vip.findActiveEntitlement(principal.tenantId)) != null;
    const evaluatedAt = new Date();
    const windowStartsAt = this.vip.quotaWindowStart(evaluatedAt);
    const snapshot = entitled
      ? await this.vip.client.$transaction(async (tx) => {
          await this.vip.expireStaleReservations(evaluatedAt, tx);
          const usedQuota = await this.vip.quotaUsedSince(tx, principal.tenantId, windowStartsAt);
          const activeDraft = await this.vip.findActiveDraft(principal.tenantId, tx);
          const inProgressRows = await this.vip.listInProgressRequests(
            principal.tenantId,
            VIP_CAPABILITY_IN_PROGRESS_LIMIT + 1,
            tx,
          );
          return { usedQuota, activeDraft, inProgressRows };
        })
      : { usedQuota: 0, activeDraft: null, inProgressRows: [] };
    const activeDraft = snapshot.activeDraft ? toVipRequest(snapshot.activeDraft) : null;
    const inProgressRequestsHasMore =
      snapshot.inProgressRows.length > VIP_CAPABILITY_IN_PROGRESS_LIMIT;
    return {
      entitled,
      usedQuota: snapshot.usedQuota,
      remainingQuota: Math.max(0, VIP_QUOTA_MAX - snapshot.usedQuota),
      quotaMax: VIP_QUOTA_MAX,
      quotaWindowDays: VIP_QUOTA_WINDOW_DAYS,
      quotaEvaluatedAt: evaluatedAt.toISOString(),
      quotaWindowStartsAt: windowStartsAt.toISOString(),
      allowedRequestCounts: [...VIP_ALLOWED_REQUEST_COUNTS],
      activeDraft,
      inProgressRequests: snapshot.inProgressRows
        .slice(0, VIP_CAPABILITY_IN_PROGRESS_LIMIT)
        .map((row) => toVipRequest({ ...row, sampleWorks: [] })),
      inProgressRequestsHasMore,
      currentRequest: activeDraft,
    };
  }
}

@Injectable()
export class ListVipRegionsUseCase {
  constructor(private readonly vip: VipRepository) {}

  async execute(principal: AuthenticatedPrincipal) {
    if (!(await this.vip.findActiveEntitlement(principal.tenantId))) {
      throw new ForbiddenError('VIP outreach is not enabled for this salon');
    }
    await this.vip.expireStaleReservations(new Date(), this.vip.client);
    const items = await this.vip.summarizeAvailableRegions();
    return { items };
  }
}

@Injectable()
export class ListActiveVipListsUseCase {
  constructor(private readonly vip: VipRepository) {}

  async execute(principal: AuthenticatedPrincipal, regionCode?: string) {
    if (!(await this.vip.findActiveEntitlement(principal.tenantId))) {
      throw new ForbiddenError('VIP outreach is not enabled for this salon');
    }
    if (!regionCode || !isVipRegionCode(regionCode)) {
      throw new ValidationError('regionCode must be a canonical VIP region');
    }
    await this.vip.expireStaleReservations(new Date(), this.vip.client);
    const items = await this.vip.listActiveListsByRegion(regionCode);
    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        regionCode: row.regionCode,
        regionName: vipRegionName(regionCode),
        status: row.status,
        contactCount: row.contactCount,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

@Injectable()
export class CreateVipRequestUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vip: VipRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    body: CreateVipRequestDto,
    idempotencyKey: string,
  ) {
    const geographicRange = sanitizeGeo(body.geographicRange);
    const requestHash = vipRequestCreateHash(body.listId, body.requestedCount, geographicRange);
    const requestId = createId();
    const now = new Date();

    try {
      await this.prisma.client.$transaction(
        async (tx) => {
          const claimed = await replayOrClaim(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: VIP_REQUEST_CREATE_OPERATION,
            key: idempotencyKey,
            requestHash,
            resourceType: 'vip_request',
            resourceId: requestId,
          });
          if (claimed !== 'inserted') {
            return;
          }
          await this.vip.expireStaleReservations(now, tx);
          const entitlement = await this.vip.lockEntitlement(tx, principal.tenantId);
          if (!entitlement || entitlement.revoked_at) {
            throw new ForbiddenError('VIP outreach is not enabled for this salon');
          }
          const draft = await this.vip.findActiveDraft(principal.tenantId, tx);
          if (draft) {
            throw new ConflictError(VIP_ONE_ACTIVE_DRAFT_MESSAGE);
          }
          const used = await this.vip.quotaUsedSince(
            tx,
            principal.tenantId,
            this.vip.quotaWindowStart(now),
          );
          if (used + body.requestedCount > VIP_QUOTA_MAX) {
            throw new ConflictError(VIP_QUOTA_EXCEEDED_MESSAGE);
          }
          const reserved = await this.vip.tryReserveList(tx, body.listId, principal.tenantId, now);
          if (!reserved) {
            throw new ConflictError('This VIP list is not available');
          }
          const list = await tx.vipTargetList.findUniqueOrThrow({
            where: { id: body.listId },
            select: { contactCount: true, name: true },
          });
          if (list.contactCount < body.requestedCount) {
            throw new ValidationError('This VIP list does not have enough contacts');
          }
          const contacts = await this.vip.selectContacts(body.listId, body.requestedCount, tx);
          if (contacts.length !== body.requestedCount) {
            throw new ValidationError('This VIP list does not have enough contacts');
          }
          await tx.vipRequest.create({
            data: {
              id: requestId,
              salonId: principal.tenantId,
              listId: body.listId,
              createdByUserId: principal.userId,
              requestedCount: body.requestedCount,
              geographicRange,
              status: 'AWAITING_SAMPLE_WORK',
              reservedUntil: this.vip.reservationDeadline(now),
              updatedAt: now,
              recipients: {
                create: contacts.map((contact, index) => ({
                  id: createId(),
                  sortOrder: index + 1,
                  sourceContactId: contact.id,
                  displayName: contact.displayName,
                  phoneNumber: contact.phoneNumber,
                  messageText: renderVipMessageTemplate(contact.displayName, geographicRange),
                })),
              },
            },
          });
          await tx.outboxEvent.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              eventType: DOMAIN_EVENT_TYPES.VipRequestCreated,
              payload: { vipRequestId: requestId, salonId: principal.tenantId, listId: body.listId },
            },
          });
          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              actorId: principal.userId,
              action: 'VIP_REQUEST_CREATED',
              resource: 'vip_request',
              resourceId: requestId,
              result: 'SUCCESS',
              metadata: { listId: body.listId, requestedCount: body.requestedCount },
            },
          });
        },
        { timeout: VIP_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      if (
        error instanceof ForbiddenError ||
        error instanceof ConflictError ||
        error instanceof ValidationError ||
        error instanceof NotFoundError
      ) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta ?? {});
        if (target.includes('vip_requests_one_awaiting_draft_per_salon')) {
          throw new ConflictError(VIP_ONE_ACTIVE_DRAFT_MESSAGE);
        }
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }

    const record = await this.prisma.client.idempotencyRecord.findUnique({
      where: {
        tenantId_actorId_operation_key: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: VIP_REQUEST_CREATE_OPERATION,
          key: idempotencyKey,
        },
      },
    });
    const id = record?.resourceId ?? requestId;
    const created = await this.vip.findRequestForSalon(principal.tenantId, id);
    if (!created) {
      throw new NotFoundError('VIP request not found');
    }
    return toVipRequest(created);
  }
}

@Injectable()
export class UploadVipSampleWorkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vip: VipRepository,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    requestId: string,
    file: { buffer: Buffer; originalname: string; size: number },
    idempotencyKey: string,
  ) {
    if (!file?.buffer?.length) {
      throw new ValidationError('Upload an image file');
    }
    assertSafeObjectFileName(file.originalname || 'image.jpg');
    if (file.size > VIP_SAMPLE_WORK_MAX_BYTES || file.buffer.length > VIP_SAMPLE_WORK_MAX_BYTES) {
      throw new ValidationError(
        `Each sample-work image must be at most ${VIP_SAMPLE_WORK_MAX_BYTES / (1024 * 1024)} MB`,
      );
    }
    const contentType = detectVipImageContentType(file.buffer);
    if (!contentType) {
      throw new ValidationError('Only JPEG, PNG, or WebP images are supported');
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const requestHash = vipSampleWorkHash(requestId, sha256);
    const prior = await findIdempotencyRecord(this.prisma.client, {
      tenantId: principal.tenantId, actorId: principal.userId,
      operation: VIP_SAMPLE_WORK_UPLOAD_OPERATION, key: idempotencyKey,
    });
    if (prior?.resourceType === 'vip_sample_work') {
      assertSameIdempotentRequest(prior.requestHash, requestHash);
      // Phase 10 changed the record target from committed sample to upload intent.
      // The old API could still write this shape after the migration during rollout.
      // Verify the predecessor key and committed sample rather than a timestamp.
      const sample = await this.prisma.client.vipSampleWork.findFirst({
        where: { id: prior.resourceId, vipRequestId: requestId, salonId: principal.tenantId },
      });
      if (!sample || sample.sha256 !== sha256 || sample.byteSize !== file.buffer.length ||
          sample.contentType !== contentType ||
          sample.objectKey !== `vip/${principal.tenantId}/${requestId}/${sample.id}`) {
        throw new NotFoundError('Sample work not found');
      }
      await readVerifiedVipSampleObject(this.storage, sample);
      const verified = await this.prisma.client.vipSampleWork.updateMany({
        where: { id: sample.id, vipRequestId: requestId, salonId: principal.tenantId,
          objectKey: sample.objectKey, sha256: sample.sha256, byteSize: sample.byteSize,
          contentType: sample.contentType },
        data: { verifiedAt: new Date() },
      });
      if (verified.count !== 1) throw new NotFoundError('Sample work not found');
      const request = await this.vip.findRequestForSalon(principal.tenantId, requestId);
      if (!request) throw new NotFoundError('VIP request not found');
      return toVipRequest(request);
    }
    const now = new Date();
    const execution = await this.prisma.client.$transaction(async (tx) => {
      await this.vip.expireStaleReservations(now, tx);
      await tx.$queryRaw`SELECT id FROM vip_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
      const request = await tx.vipRequest.findFirst({
        where: { id: requestId, salonId: principal.tenantId },
        include: { sampleWorks: { select: { position: true } } },
      });
      if (!request) throw new NotFoundError('VIP request not found');

      const existingKey = await findIdempotencyRecord(tx, {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        operation: VIP_SAMPLE_WORK_UPLOAD_OPERATION,
        key: idempotencyKey,
      });
      if (existingKey) assertSameIdempotentRequest(existingKey.requestHash, requestHash);

      let upload = existingKey
        ? await tx.vipSampleWorkUpload.findUnique({ where: { id: existingKey.resourceId } })
        : await tx.vipSampleWorkUpload.findUnique({
            where: { vipRequestId_sha256: { vipRequestId: requestId, sha256 } },
          });
      if (existingKey && !upload) throw new NotFoundError('Upload intent not found');

      const uploadId = upload?.id ?? createId();
      if (!existingKey) {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(), tenantId: principal.tenantId, actorId: principal.userId,
          operation: VIP_SAMPLE_WORK_UPLOAD_OPERATION, key: idempotencyKey,
          requestHash, resourceType: 'vip_sample_work_upload', resourceId: uploadId,
        });
        if (!claim.inserted) throw new ConflictError('Upload retry conflicted; retry the request');
      }
      if (!upload) {
        const committed = await tx.vipSampleWork.findFirst({
          where: { vipRequestId: requestId, salonId: principal.tenantId, sha256 },
          select: { id: true },
        });
        if (committed) throw new ConflictError('This sample-work image was already uploaded');
        upload = await tx.vipSampleWorkUpload.create({ data: {
          id: uploadId, vipRequestId: requestId, salonId: principal.tenantId,
          sha256, contentType, byteSize: file.buffer.length, status: 'RETRYABLE',
        } });
      }
      if (upload.vipRequestId !== requestId || upload.salonId !== principal.tenantId) {
        throw new NotFoundError('Upload intent not found');
      }
      if (upload.status === 'AVAILABLE') return { kind: 'available' as const };

      const eligible = request.status === 'AWAITING_SAMPLE_WORK' &&
        request.reservedUntil.getTime() >= now.getTime();
      if (!eligible) {
        if (upload.status === 'UPLOADING' && upload.objectKey) {
          await enqueueVipObjectCleanup(tx, upload.id, upload.generation, upload.objectKey,
            cleanupSchedule(upload.lockedUntil, this.config.values.MINIO_REQUEST_TIMEOUT_MS,
              this.config.values.VIP_UPLOAD_CLEANUP_SETTLE_MS, now));
        }
        await tx.vipSampleWorkUpload.updateMany({
          where: { id: upload.id, status: { not: 'AVAILABLE' } },
          data: { status: 'ABANDONED', position: null, ownerToken: null, lockedUntil: null,
            sampleWorkId: null, lastErrorCode: 'REQUEST_INELIGIBLE' },
        });
        throw new ConflictError('Sample work cannot be added in the current state');
      }

      if (upload.status === 'UPLOADING') {
        if (upload.lockedUntil && upload.lockedUntil.getTime() > now.getTime()) {
          throw new ConflictError('This sample-work upload is already in progress');
        }
        if (upload.objectKey) {
          await enqueueVipObjectCleanup(tx, upload.id, upload.generation, upload.objectKey,
            cleanupSchedule(upload.lockedUntil, this.config.values.MINIO_REQUEST_TIMEOUT_MS,
              this.config.values.VIP_UPLOAD_CLEANUP_SETTLE_MS, now));
        }
        upload = await tx.vipSampleWorkUpload.update({
          where: { id: upload.id },
          data: { status: 'RETRYABLE', position: null, ownerToken: null, lockedUntil: null,
            lastErrorCode: 'LEASE_EXPIRED' },
        });
      }
      if (upload.status === 'ABANDONED') {
        throw new ConflictError('Sample work cannot be added in the current state');
      }

      const pending = await tx.vipSampleWorkUpload.findMany({
        where: { vipRequestId: requestId, status: 'UPLOADING', position: { not: null } },
        select: { position: true },
      });
      const used = new Set([
        ...request.sampleWorks.map((row) => row.position),
        ...pending.flatMap((row) => row.position == null ? [] : [row.position]),
      ]);
      const position = [1, 2, 3].find((value) => !used.has(value));
      if (!position) throw new ValidationError('At most 3 sample-work images are allowed');

      const generation = upload.generation + 1;
      const ownerToken = createId();
      const objectKey = `vip/${principal.tenantId}/${requestId}/${upload.id}/g${generation}`;
      const lockedUntil = new Date(now.getTime() + this.config.values.VIP_UPLOAD_LEASE_MS);
      await tx.vipSampleWorkUpload.update({
        where: { id: upload.id },
        data: { status: 'UPLOADING', position, generation, objectKey, ownerToken,
          lockedUntil, lastErrorCode: null },
      });
      // Authorization is fixed before intent commit. A paused obsolete attempt
      // cannot obtain a fresh storage signature after its lease has expired.
      if (!this.storage.preparePutObject) {
        throw new InfrastructureError('File storage is temporarily unavailable');
      }
      const preparedPut = this.storage.preparePutObject({
        key: objectKey, body: file.buffer, contentType, expiresAt: lockedUntil,
      });
      return { kind: 'upload' as const, uploadId: upload.id, generation, ownerToken,
        objectKey, position, lockedUntil, preparedPut };
    });

    if (execution.kind === 'upload') {
      await execution.preparedPut.execute();
      await readVerifiedVipSampleObject(this.storage, {
        objectKey: execution.objectKey, contentType, byteSize: file.buffer.length, sha256,
      });
      const finalized = await this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM vip_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
        const [request, upload] = await Promise.all([
          tx.vipRequest.findFirst({ where: { id: requestId, salonId: principal.tenantId } }),
          tx.vipSampleWorkUpload.findUnique({ where: { id: execution.uploadId } }),
        ]);
        const owned = upload?.status === 'UPLOADING' && upload.generation === execution.generation &&
          upload.ownerToken === execution.ownerToken && upload.objectKey === execution.objectKey &&
          upload.position === execution.position;
        const eligible = request?.status === 'AWAITING_SAMPLE_WORK' &&
          request.reservedUntil.getTime() >= new Date().getTime();
        if (!owned || !eligible) {
          await enqueueVipObjectCleanup(tx, execution.uploadId, execution.generation,
            execution.objectKey, cleanupSchedule(execution.lockedUntil,
              this.config.values.MINIO_REQUEST_TIMEOUT_MS,
              this.config.values.VIP_UPLOAD_CLEANUP_SETTLE_MS, new Date()));
          if (owned) {
            await tx.vipSampleWorkUpload.update({
              where: { id: execution.uploadId },
              data: { status: eligible ? 'RETRYABLE' : 'ABANDONED', position: null,
                ownerToken: null, lockedUntil: null, lastErrorCode: 'FINALIZE_OWNERSHIP_LOST' },
            });
          }
          return false;
        }
        const verifiedAt = new Date();
        await tx.vipSampleWork.create({ data: {
          id: execution.uploadId, vipRequestId: requestId, salonId: principal.tenantId,
          position: execution.position, objectKey: execution.objectKey, contentType,
          byteSize: file.buffer.length, sha256, verifiedAt,
        } });
        const moved = await tx.vipSampleWorkUpload.updateMany({
          where: { id: execution.uploadId, status: 'UPLOADING', generation: execution.generation,
            ownerToken: execution.ownerToken, objectKey: execution.objectKey },
          data: { status: 'AVAILABLE', position: null, ownerToken: null, lockedUntil: null,
            sampleWorkId: execution.uploadId, verifiedAt, lastErrorCode: null },
        });
        if (moved.count !== 1) throw new ConflictError('Upload ownership was lost');
        return true;
      });
      if (!finalized) throw new ConflictError('Upload ownership was lost; retry the request');
    }

    const request = await this.vip.findRequestForSalon(principal.tenantId, requestId);
    if (!request) {
      throw new NotFoundError('VIP request not found');
    }
    return toVipRequest(request);
  }
}

function cleanupSchedule(
  lockedUntil: Date | null,
  timeoutMs: number,
  settleMs: number,
  now: Date,
): { availableAt: Date; settleUntil: Date } {
  const base = Math.max(now.getTime(), lockedUntil?.getTime() ?? 0);
  return {
    availableAt: new Date(base + timeoutMs),
    settleUntil: new Date(base + settleMs),
  };
}

async function enqueueVipObjectCleanup(
  tx: Prisma.TransactionClient,
  uploadId: string,
  generation: number,
  objectKey: string,
  schedule: { availableAt: Date; settleUntil: Date },
) {
  await tx.$executeRaw`
    INSERT INTO vip_sample_work_cleanups
      (id, upload_id, object_key, upload_generation, status, request_generation,
       claim_generation, available_at, settle_until, delete_passes, attempts, created_at)
    VALUES
      (${createId()}::uuid, ${uploadId}::uuid, ${objectKey}, ${generation}, 'PENDING',
       1, 0, ${schedule.availableAt}, ${schedule.settleUntil}, 0, 0, NOW())
    ON CONFLICT (object_key) DO UPDATE
      SET request_generation = vip_sample_work_cleanups.request_generation + 1,
          status = CASE
            WHEN vip_sample_work_cleanups.status = 'PROCESSED' THEN 'PENDING'::"VipSampleCleanupStatus"
            ELSE vip_sample_work_cleanups.status
          END,
          available_at = LEAST(vip_sample_work_cleanups.available_at, EXCLUDED.available_at),
          settle_until = GREATEST(vip_sample_work_cleanups.settle_until, EXCLUDED.settle_until),
          processed_at = CASE
            WHEN vip_sample_work_cleanups.status = 'PROCESSED' THEN NULL
            ELSE vip_sample_work_cleanups.processed_at
          END,
          last_error_code = NULL
  `;
}

@Injectable()
export class SubmitVipRequestUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vip: VipRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(principal: AuthenticatedPrincipal, requestId: string, idempotencyKey: string) {
    const requestHash = vipRequestSubmitHash(requestId);
    const existing = await findIdempotencyRecord(this.prisma.client, {
      tenantId: principal.tenantId,
      actorId: principal.userId,
      operation: VIP_REQUEST_SUBMIT_OPERATION,
      key: idempotencyKey,
    });
    if (existing) {
      assertSameIdempotentRequest(existing.requestHash, requestHash);
      const replay = await this.vip.findRequestForSalon(principal.tenantId, existing.resourceId);
      if (!replay) throw new NotFoundError('VIP request not found');
      return toVipRequest(replay);
    }

    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await this.vip.expireStaleReservations(now, tx);
    });

    const candidate = await this.prisma.client.vipRequest.findFirst({
      where: { id: requestId, salonId: principal.tenantId },
      include: { sampleWorks: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    if (!candidate) throw new NotFoundError('VIP request not found');
    if (candidate.status !== 'AWAITING_SAMPLE_WORK') {
      throw new ConflictError('This VIP request cannot be submitted');
    }
    if (candidate.sampleWorks.length < VIP_MIN_SAMPLE_WORKS) {
      throw new ValidationError('Upload at least one sample-work image');
    }
    if (candidate.sampleWorks.length > VIP_MAX_SAMPLE_WORKS) {
      throw new ValidationError('At most 3 sample-work images are allowed');
    }

    // Storage reads are deliberately outside the transaction. AVAILABLE and verifiedAt prove
    // only that these exact bytes were readable at this point in time.
    await Promise.all(candidate.sampleWorks.map((sample) => readVerifiedVipSampleObject(this.storage, sample)));
    const verifiedIds = candidate.sampleWorks.map((sample) => sample.id);
    const evidence = candidate.sampleWorks.map((sample) =>
      `${sample.id}:${sample.objectKey}:${sample.sha256}:${sample.byteSize}:${sample.contentType}`,
    );

    await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
      const claimed = await replayOrClaim(tx, {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        operation: VIP_REQUEST_SUBMIT_OPERATION,
        key: idempotencyKey,
        requestHash,
        resourceType: 'vip_request',
        resourceId: requestId,
      });
      if (claimed !== 'inserted') {
        return;
      }
      const request = await tx.vipRequest.findFirst({
        where: { id: requestId, salonId: principal.tenantId },
        include: { sampleWorks: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
      });
      if (!request) {
        throw new NotFoundError('VIP request not found');
      }
      if (request.status !== 'AWAITING_SAMPLE_WORK') {
        throw new ConflictError('This VIP request cannot be submitted');
      }
      if (request.sampleWorks.length < VIP_MIN_SAMPLE_WORKS) {
        throw new ValidationError('Upload at least one sample-work image');
      }
      if (request.sampleWorks.length > VIP_MAX_SAMPLE_WORKS) {
        throw new ValidationError('At most 3 sample-work images are allowed');
      }
      const latestEvidence = request.sampleWorks.map((sample) =>
        `${sample.id}:${sample.objectKey}:${sample.sha256}:${sample.byteSize}:${sample.contentType}`,
      );
      if (latestEvidence.length !== evidence.length || latestEvidence.some((value, index) => value !== evidence[index])) {
        throw new ConflictError('Sample work changed during submission; retry the request');
      }
      // PostgreSQL evaluates this time at the final statement, after storage I/O
      // and lock acquisition. All uses within the statement share one instant.
      const moved = await tx.$queryRaw<Array<{ submittedAt: Date }>>`
        UPDATE vip_requests
           SET status = 'SUBMITTED'::"VipRequestStatus",
               submitted_at = statement_timestamp(),
               updated_at = statement_timestamp()
         WHERE id = ${requestId}::uuid
           AND salon_id = ${principal.tenantId}::uuid
           AND status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
           AND reserved_until >= statement_timestamp()
           AND submitted_at IS NULL
           AND cancelled_at IS NULL
        RETURNING submitted_at AS "submittedAt"
      `;
      if (moved.length !== 1) {
        const decisionNow = (await tx.$queryRaw<Array<{ decisionNow: Date }>>`
          SELECT statement_timestamp() AS "decisionNow"
        `)[0]!.decisionNow;
        const latest = await tx.vipRequest.findFirst({
          where: { id: requestId, salonId: principal.tenantId },
          select: { status: true, reservedUntil: true, submittedAt: true, cancelledAt: true },
        });
        if (
          latest?.status === 'CANCELLED' ||
          (latest != null && latest.reservedUntil.getTime() < decisionNow.getTime())
        ) {
          throw new ConflictError(VIP_RESERVATION_EXPIRED_MESSAGE);
        }
        throw new ConflictError('This VIP request cannot be submitted');
      }
      const decisionNow = moved[0]!.submittedAt;
      await tx.vipSampleWork.updateMany({
        where: { id: { in: verifiedIds }, vipRequestId: requestId, salonId: principal.tenantId },
        data: { verifiedAt: decisionNow },
      });
      await tx.vipSampleWorkUpload.updateMany({
        where: { sampleWorkId: { in: verifiedIds }, status: 'AVAILABLE' },
        data: { verifiedAt: decisionNow },
      });
      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          eventType: DOMAIN_EVENT_TYPES.VipRequestSubmitted,
          payload: { vipRequestId: requestId, salonId: principal.tenantId },
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'VIP_REQUEST_SUBMITTED',
          resource: 'vip_request',
          resourceId: requestId,
          result: 'SUCCESS',
          metadata: { sampleWorkCount: request.sampleWorks.length },
        },
      });
    });
    const request = await this.vip.findRequestForSalon(principal.tenantId, requestId);
    if (!request) {
      throw new NotFoundError('VIP request not found');
    }
    return toVipRequest(request);
  }
}

@Injectable()
export class GetSalonVipRequestUseCase {
  constructor(private readonly vip: VipRepository) {}

  async execute(principal: AuthenticatedPrincipal, id: string) {
    const request = await this.vip.findRequestForSalon(principal.tenantId, id);
    if (!request) {
      throw new NotFoundError('VIP request not found');
    }
    return toVipRequest(request);
  }
}

@Injectable()
export class DownloadVipSampleWorkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async executeForAdmin(imageId: string) {
    const image = await this.prisma.client.vipSampleWork.findUnique({ where: { id: imageId } });
    if (!image) {
      throw new NotFoundError('Sample work not found');
    }
    return this.readAndRecord(image);
  }

  async executeForSalon(principal: AuthenticatedPrincipal, imageId: string) {
    const image = await this.prisma.client.vipSampleWork.findFirst({
      where: { id: imageId, salonId: principal.tenantId },
    });
    if (!image) {
      throw new NotFoundError('Sample work not found');
    }
    return this.readAndRecord(image);
  }

  private async readAndRecord(image: {
    id: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
  }) {
    const stored = await readVerifiedVipSampleObject(this.storage, image);
    const verifiedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.vipSampleWork.updateMany({
        where: { id: image.id, objectKey: image.objectKey, sha256: image.sha256 },
        data: { verifiedAt },
      });
      await tx.vipSampleWorkUpload.updateMany({
        where: { sampleWorkId: image.id, status: 'AVAILABLE', objectKey: image.objectKey },
        data: { verifiedAt },
      });
    });
    return stored;
  }
}

@Injectable()
export class ExportVipRequestExcelUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(requestId: string): Promise<{ buffer: Buffer; filename: string }> {
    const request = await this.prisma.client.vipRequest.findUnique({
      where: { id: requestId },
      include: {
        recipients: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!request) {
      throw new NotFoundError('VIP request not found');
    }
    if (request.status === 'AWAITING_SAMPLE_WORK' || request.status === 'CANCELLED') {
      throw new ConflictError('Export is available after the salon submits sample work');
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Salon Attention';
    const sheet = workbook.addWorksheet(VIP_EXPORT_SHEET_NAME);
    sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    sheet.addRow([...VIP_EXPORT_HEADERS]);
    for (const recipient of request.recipients) {
      sheet.addRow([
        excelSafeText(recipient.displayName),
        recipient.phoneNumber,
        excelSafeText(recipient.messageText),
      ]);
    }
    sheet.getRow(1).font = { bold: true, name: 'Tahoma' };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: VIP_EXPORT_FILENAME };
  }
}

@Injectable()
export class DispatchVipRequestUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vip: VipRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    requestId: string,
    mode: 'MANUAL' | 'BALE',
    idempotencyKey: string,
  ) {
    const requestHash = vipDispatchHash(requestId, mode);
    const now = new Date();
    try {
      await this.prisma.client.$transaction(
        async (tx) => {
          const dispatchIdempotencyClaim = await replayOrClaim(tx, {
            tenantId: admin.adminId,
            actorId: admin.adminId,
            operation: mode === 'MANUAL' ? VIP_DISPATCH_MANUAL_OPERATION : VIP_DISPATCH_BALE_OPERATION,
            key: idempotencyKey,
            requestHash,
            resourceType: 'vip_request',
            resourceId: requestId,
          });
          if (dispatchIdempotencyClaim !== 'inserted') {
            return;
          }
          // Serialize every dispatch mode on the request row before reading its state.
          await tx.$queryRaw`SELECT id FROM vip_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
          const request = await tx.vipRequest.findUnique({
            where: { id: requestId },
            include: { recipients: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
          });
          if (!request) {
            throw new NotFoundError('VIP request not found');
          }
          if (request.status === 'MANUAL_QUEUED' && mode === 'MANUAL') {
            return;
          }
          if (request.status === 'BALE_NOT_IMPLEMENTED' && mode === 'BALE') {
            return;
          }
          if (request.status !== 'SUBMITTED' && request.status !== 'BALE_NOT_IMPLEMENTED') {
            throw new ConflictError('This VIP request cannot be dispatched');
          }
          if (mode === 'BALE') {
            const baleClaim = await tx.vipRequest.updateMany({
              where: { id: requestId, status: 'SUBMITTED' },
              data: { status: 'BALE_NOT_IMPLEMENTED', updatedAt: now },
            });
            if (baleClaim.count === 0) return;
            await tx.auditLog.create({
              data: {
                id: createId(),
                tenantId: request.salonId,
                actorId: admin.adminId,
                action: 'VIP_DISPATCH_SELECTED',
                resource: 'vip_request',
                resourceId: requestId,
                result: 'SUCCESS',
                metadata: { mode: 'BALE', implemented: false },
              },
            });
            return;
          }

          const manualClaim = await tx.vipRequest.updateMany({
            where: { id: requestId, status: { in: ['SUBMITTED', 'BALE_NOT_IMPLEMENTED'] } },
            data: { status: 'MANUAL_QUEUED', updatedAt: now },
          });
          if (manualClaim.count === 0) {
            throw new ConflictError('This VIP request cannot be dispatched');
          }

          for (const recipient of request.recipients) {
            if (recipient.messageRequestId) {
              continue;
            }
            if (!isUsableCustomerPhone(recipient.phoneNumber)) {
              throw new ValidationError('A stored VIP recipient phone is invalid');
            }
            const messageRequestId = createId();
            await tx.messageRequest.create({
              data: {
                id: messageRequestId,
                salonId: request.salonId,
                customerId: null,
                actionId: null,
                createdByUserId: request.createdByUserId,
                opportunityType: null,
                vipRequestId: request.id,
                recipientDisplayName: recipient.displayName,
                recipientPhoneNumber: recipient.phoneNumber,
                messageText: recipient.messageText,
                requestedAt: now,
                messageBusinessDate: messageBusinessDateValue(now),
                countsTowardDailyLimit: false,
                status: 'QUEUED',
                updatedAt: now,
              },
            });
            await tx.vipRequestRecipient.update({
              where: { id: recipient.id },
              data: { messageRequestId },
            });
            await tx.outboxEvent.create({
              data: {
                id: createId(),
                tenantId: request.salonId,
                eventType: DOMAIN_EVENT_TYPES.MessageRequested,
                payload: {
                  messageRequestId,
                  salonId: request.salonId,
                  vipRequestId: request.id,
                },
              },
            });
          }
          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: request.salonId,
              actorId: admin.adminId,
              action: 'VIP_DISPATCH_SELECTED',
              resource: 'vip_request',
              resourceId: requestId,
              result: 'SUCCESS',
              metadata: { mode: 'MANUAL', messageCount: request.recipients.length },
            },
          });
        },
        { timeout: VIP_DISPATCH_TX_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      // Historical cross-salon creators can still appear in pre-validation VIP
      // requests. The transaction has rolled back the claim and all effects.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003' &&
          String(error.meta?.field_name).includes('message_requests_created_by_user_id_salon_id_fkey')) {
        throw new ConflictError('VIP request creator cannot be used for dispatch');
      }
      throw error;
    }
    const request = await this.vip.findRequestById(requestId);
    if (!request) {
      throw new NotFoundError('VIP request not found');
    }
    return toVipRequest(request);
  }
}
