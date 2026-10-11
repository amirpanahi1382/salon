import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';

type VisitIntentionSubject = 'CUSTOMER' | 'VIP_PROSPECT';
type VisitIntentionTimePrecision = 'UNKNOWN' | 'DATE' | 'INSTANT';
type VisitIntentionReportChannel =
  | 'SALON_STAFF'
  | 'TOLD_PLATFORM_ADMIN'
  | 'INBOUND_TO_SALON'
  | 'REPORTED_DURING_MANUAL_HANDLING';
type VisitIntentionContactBasis = 'WITHHELD' | 'SALON_SUPPLIED' | 'ADMIN_AUTHORIZED';
import { createId, ValidationError } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  decodeCursor,
  encodeCursor,
  parseCursorInteger,
  parseCursorUuid,
  toListPage,
  type ListPage,
} from '../infrastructure/http/list-page';
import { operationallyOpenReturnCommitmentSql } from '../return-commitment/operational-open-return-commitment.sql';
import {
  agreedDateAsUtcNoon,
  formatAgreedDate,
  type ParsedVisitIntentionTime,
} from './visit-intention.time';

const PAGE_DEFAULT = 20;

export type IntentionAudience = 'SALON' | 'ADMIN';

export type VisitIntentionRecord = {
  id: string;
  salonId: string;
  subject: VisitIntentionSubject;
  customerId: string | null;
  sourceMessageRequestId: string | null;
  vipRequestId: string | null;
  vipRequestRecipientId: string | null;
  disclosedDisplayName: string | null;
  disclosedPhone: string | null;
  contactBasis: VisitIntentionContactBasis;
  timePrecision: VisitIntentionTimePrecision;
  agreedDate: Date | null;
  agreedInstant: Date | null;
  reportChannel: VisitIntentionReportChannel;
  createdByUserId: string | null;
  createdByPlatformAdminId: string | null;
  linkedVisitId: string | null;
  linkedCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type WriteActor =
  | { kind: 'SALON_USER'; userId: string }
  | { kind: 'PLATFORM_ADMIN'; adminId: string };

const intentionSelect = {
  id: true,
  salonId: true,
  subject: true,
  customerId: true,
  sourceMessageRequestId: true,
  vipRequestId: true,
  vipRequestRecipientId: true,
  disclosedDisplayName: true,
  disclosedPhone: true,
  contactBasis: true,
  timePrecision: true,
  agreedDate: true,
  agreedInstant: true,
  reportChannel: true,
  createdByUserId: true,
  createdByPlatformAdminId: true,
  linkedVisitId: true,
  linkedCustomerId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VisitIntentionSelect;

@Injectable()
export class VisitIntentionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(
    salonId: string,
    id: string,
    db: Prisma.TransactionClient | PrismaService['client'] = this.prisma.client,
  ): Promise<VisitIntentionRecord | null> {
    return db.visitIntention.findFirst({
      where: { id, salonId },
      select: intentionSelect,
    });
  }

  async lockById(
    tx: Prisma.TransactionClient,
    salonId: string,
    id: string,
  ): Promise<VisitIntentionRecord | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM visit_intentions
      WHERE id = ${id}::uuid AND salon_id = ${salonId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) return null;
    return this.findById(salonId, id, tx);
  }

  async insert(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      salonId: string;
      subject: VisitIntentionSubject;
      customerId: string | null;
      sourceMessageRequestId: string | null;
      vipRequestId: string | null;
      vipRequestRecipientId: string | null;
      disclosedDisplayName: string | null;
      disclosedPhone: string | null;
      contactBasis: VisitIntentionContactBasis;
      time: ParsedVisitIntentionTime;
      reportChannel: VisitIntentionReportChannel;
      actor: WriteActor;
      now: Date;
    },
  ): Promise<void> {
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    await tx.visitIntention.create({
      data: {
        id: input.id,
        salonId: input.salonId,
        subject: input.subject,
        customerId: input.customerId,
        sourceMessageRequestId: input.sourceMessageRequestId,
        vipRequestId: input.vipRequestId,
        vipRequestRecipientId: input.vipRequestRecipientId,
        disclosedDisplayName: input.disclosedDisplayName,
        disclosedPhone: input.disclosedPhone,
        contactBasis: input.contactBasis,
        timePrecision: input.time.precision,
        agreedDate: input.time.precision === 'DATE' ? agreedDateAsUtcNoon(input.time.agreedDate) : null,
        agreedInstant: input.time.precision === 'INSTANT' ? input.time.agreedInstant : null,
        reportChannel: input.reportChannel,
        createdByUserId: userId,
        createdByPlatformAdminId: adminId,
        updatedByUserId: userId,
        updatedByPlatformAdminId: adminId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    if (input.subject === 'VIP_PROSPECT') {
      await tx.visitIntentionContactRevision.create({
        data: {
          id: createId(),
          visitIntentionId: input.id,
          salonId: input.salonId,
          revision: 1,
          contactBasis: input.contactBasis,
          disclosedDisplayName: input.disclosedDisplayName,
          disclosedPhone: input.disclosedPhone,
          recordedByUserId: userId,
          recordedByPlatformAdminId: adminId,
          createdAt: input.now,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        actorId: userId ?? adminId,
        action: 'VISIT_INTENTION_CREATED',
        resource: 'visit_intention',
        resourceId: input.id,
        result: 'SUCCESS',
        metadata: {
          subject: input.subject,
          customerId: input.customerId,
          vipRequestId: input.vipRequestId,
          vipRequestRecipientId: input.vipRequestRecipientId,
          sourceMessageRequestId: input.sourceMessageRequestId,
          reportChannel: input.reportChannel,
          contactBasis: input.contactBasis,
          timePrecision: input.time.precision,
          agreedDate: input.time.precision === 'DATE' ? input.time.agreedDate : null,
          agreedInstant: input.time.precision === 'INSTANT' ? input.time.agreedInstant.toISOString() : null,
        },
      },
    });
  }

  async correctTime(
    tx: Prisma.TransactionClient,
    input: {
      salonId: string;
      id: string;
      time: ParsedVisitIntentionTime;
      expectedUpdatedAt: Date;
      actor: WriteActor;
      now: Date;
      previous: VisitIntentionRecord;
    },
  ): Promise<boolean> {
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    const updated = await tx.visitIntention.updateMany({
      where: {
        id: input.id,
        salonId: input.salonId,
        updatedAt: input.expectedUpdatedAt,
      },
      data: {
        timePrecision: input.time.precision,
        agreedDate: input.time.precision === 'DATE' ? agreedDateAsUtcNoon(input.time.agreedDate) : null,
        agreedInstant: input.time.precision === 'INSTANT' ? input.time.agreedInstant : null,
        updatedByUserId: userId,
        updatedByPlatformAdminId: adminId,
        updatedAt: input.now,
      },
    });
    if (updated.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        actorId: userId ?? adminId,
        action: 'VISIT_INTENTION_TIME_CORRECTED',
        resource: 'visit_intention',
        resourceId: input.id,
        result: 'SUCCESS',
        metadata: {
          previousPrecision: input.previous.timePrecision,
          previousAgreedDate: formatAgreedDate(input.previous.agreedDate),
          previousAgreedInstant: input.previous.agreedInstant?.toISOString() ?? null,
          timePrecision: input.time.precision,
          agreedDate: input.time.precision === 'DATE' ? input.time.agreedDate : null,
          agreedInstant: input.time.precision === 'INSTANT' ? input.time.agreedInstant.toISOString() : null,
        },
      },
    });
    return true;
  }

  async correctDisclosedContact(
    tx: Prisma.TransactionClient,
    input: {
      salonId: string;
      id: string;
      disclosedDisplayName: string | null;
      disclosedPhone: string | null;
      actor: WriteActor;
      now: Date;
      previous: VisitIntentionRecord;
    },
  ): Promise<number> {
    const basis = input.previous.contactBasis;
    if (basis === 'WITHHELD') {
      throw new ValidationError('A withheld intention cannot gain contact details through correction');
    }
    if (basis === 'SALON_SUPPLIED' && input.actor.kind !== 'SALON_USER') {
      throw new ValidationError('Only the salon can correct contact details it recorded');
    }
    if (basis === 'ADMIN_AUTHORIZED' && input.actor.kind !== 'PLATFORM_ADMIN') {
      throw new ValidationError('Only Platform Admin can correct contact details it disclosed');
    }
    if (basis === 'SALON_SUPPLIED' && !input.disclosedDisplayName && !input.disclosedPhone) {
      throw new ValidationError('A salon VIP intention needs the name or phone the prospect gave the salon');
    }
    if (basis === 'ADMIN_AUTHORIZED' && (!input.disclosedDisplayName || !input.disclosedPhone)) {
      throw new ValidationError('Admin disclosure needs both the name and phone the prospect authorized for this salon');
    }
    const latest = await tx.visitIntentionContactRevision.aggregate({
      where: { visitIntentionId: input.id, salonId: input.salonId },
      _max: { revision: true },
    });
    const revision = (latest._max.revision ?? 1) + 1;
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    await tx.visitIntentionContactRevision.create({
      data: {
        id: createId(),
        visitIntentionId: input.id,
        salonId: input.salonId,
        revision,
        contactBasis: basis,
        disclosedDisplayName: input.disclosedDisplayName,
        disclosedPhone: input.disclosedPhone,
        recordedByUserId: userId,
        recordedByPlatformAdminId: adminId,
        createdAt: input.now,
      },
    });
    const updated = await tx.visitIntention.updateMany({
      where: { id: input.id, salonId: input.salonId, contactBasis: basis },
      data: {
        disclosedDisplayName: input.disclosedDisplayName,
        disclosedPhone: input.disclosedPhone,
        updatedByUserId: userId,
        updatedByPlatformAdminId: adminId,
        updatedAt: input.now,
      },
    });
    if (updated.count !== 1) {
      throw new ValidationError('Visit intention contact could not be corrected');
    }
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        actorId: userId ?? adminId,
        action: 'VISIT_INTENTION_CONTACT_CORRECTED',
        resource: 'visit_intention',
        resourceId: input.id,
        result: 'SUCCESS',
        metadata: {
          contactBasis: basis,
          revision,
        },
      },
    });
    return revision;
  }

  async listForVipRequest(
    salonId: string,
    vipRequestId: string,
    cursor: string | undefined,
    limit = PAGE_DEFAULT,
  ): Promise<ListPage<VisitIntentionRecord>> {
    const parsed = decodeCursor(cursor, 3);
    if (parsed && parsed[0] !== vipRequestId) throw new ValidationError('Invalid cursor');
    const cursorDate = parsed ? new Date(parsed[1]!) : undefined;
    const cursorId = parsed ? parseCursorUuid(parsed[2]!) : undefined;
    if (parsed && (Number.isNaN(cursorDate!.getTime()) || cursorDate!.toISOString() !== parsed[1])) {
      throw new ValidationError('Invalid cursor');
    }
    const rows = await this.prisma.client.visitIntention.findMany({
      where: {
        salonId,
        vipRequestId,
        ...(cursorDate && cursorId
          ? {
              OR: [
                { createdAt: { lt: cursorDate } },
                { createdAt: cursorDate, id: { lt: cursorId } },
              ],
            }
          : {}),
      },
      select: intentionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toListPage(rows, limit, (row) =>
      encodeCursor([vipRequestId, row.createdAt.toISOString(), row.id]),
    );
  }

  async linkVisit(
    tx: Prisma.TransactionClient,
    input: {
      salonId: string;
      id: string;
      visitId: string;
      customerId: string;
      actor: WriteActor;
      now: Date;
    },
  ): Promise<boolean> {
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    const updated = await tx.visitIntention.updateMany({
      where: { id: input.id, salonId: input.salonId, linkedVisitId: null },
      data: {
        linkedVisitId: input.visitId,
        linkedCustomerId: input.customerId,
        updatedByUserId: userId,
        updatedByPlatformAdminId: adminId,
        updatedAt: input.now,
      },
    });
    if (updated.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        actorId: userId ?? adminId,
        action: 'VISIT_INTENTION_LINKED_TO_VISIT',
        resource: 'visit_intention',
        resourceId: input.id,
        result: 'SUCCESS',
        metadata: {
          visitId: input.visitId,
          customerId: input.customerId,
        },
      },
    });
    return true;
  }

  async listForCustomer(
    salonId: string,
    customerId: string,
    cursor: string | undefined,
    limit = PAGE_DEFAULT,
  ): Promise<ListPage<VisitIntentionRecord>> {
    const parsed = decodeCursor(cursor, 2);
    const cursorDate = parsed ? new Date(parsed[0]!) : undefined;
    const cursorId = parsed ? parseCursorUuid(parsed[1]!) : undefined;
    if (parsed && (Number.isNaN(cursorDate!.getTime()) || cursorDate!.toISOString() !== parsed[0])) {
      throw new ValidationError('Invalid cursor');
    }
    const rows = await this.prisma.client.visitIntention.findMany({
      where: {
        salonId,
        customerId,
        ...(cursorDate && cursorId
          ? {
              OR: [
                { createdAt: { lt: cursorDate } },
                { createdAt: cursorDate, id: { lt: cursorId } },
              ],
            }
          : {}),
      },
      select: intentionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toListPage(rows, limit, (row) => encodeCursor([row.createdAt.toISOString(), row.id]));
  }

  async listCustomerFollowUps(salonId: string, cursor: string | undefined, limit: number, now: Date) {
    const parsed = this.parseFollowCursor(cursor);
    const rows = await this.prisma.client.$queryRaw<FollowUpSqlRow[]>`
      SELECT * FROM (
        SELECT
          'RETURN_COMMITMENT'::text AS kind,
          rc.id,
          rc.customer_id AS "customerId",
          btrim(c.first_name || ' ' || c.last_name) AS "customerDisplayName",
          CASE WHEN rc.created_by_platform_admin_id IS NULL THEN 'SALON_USER' ELSE 'PLATFORM_ADMIN' END AS "reportedBy",
          NULL::text AS "reportChannel",
          rc.created_at AS "reportedAt",
          TRUE AS "timeKnown",
          'INSTANT'::text AS "timePrecision",
          NULL::date AS "agreedDate",
          rc.expected_at AS "agreedInstant",
          (rc.expected_at < ${now}::timestamptz) AS "agreedTimePassed",
          rc.source_message_request_id AS "sourceMessageRequestId",
          NULL::uuid AS "vipRequestId",
          NULL::text AS "disclosedDisplayName",
          NULL::text AS "disclosedPhone",
          NULL::text AS "contactBasis",
          'RECORD_VISIT'::text AS "nextAction",
          0 AS sort_group,
          to_char(rc.expected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sort_value
        FROM return_commitments rc
        JOIN message_deliveries md
          ON md.id = rc.source_message_delivery_id AND md.salon_id = rc.salon_id
        JOIN customers c ON c.id = rc.customer_id AND c.salon_id = rc.salon_id
        WHERE rc.salon_id = ${salonId}::uuid
          AND ${operationallyOpenReturnCommitmentSql}
        UNION ALL
        SELECT
          'VISIT_INTENTION'::text,
          vi.id,
          vi.customer_id,
          btrim(c.first_name || ' ' || c.last_name),
          CASE WHEN vi.created_by_platform_admin_id IS NULL THEN 'SALON_USER' ELSE 'PLATFORM_ADMIN' END,
          vi.report_channel::text,
          vi.created_at,
          (vi.time_precision::text = 'INSTANT'),
          vi.time_precision::text,
          vi.agreed_date,
          vi.agreed_instant,
          (vi.time_precision::text = 'INSTANT' AND vi.agreed_instant < ${now}::timestamptz),
          vi.source_message_request_id,
          NULL::uuid,
          NULL::text,
          NULL::text,
          NULL::text,
          'RECORD_VISIT'::text,
          CASE vi.time_precision::text WHEN 'INSTANT' THEN 0 WHEN 'DATE' THEN 1 ELSE 2 END,
          CASE vi.time_precision::text
            WHEN 'INSTANT' THEN to_char(vi.agreed_instant AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            WHEN 'DATE' THEN vi.agreed_date::text
            ELSE to_char(vi.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          END
        FROM visit_intentions vi
        JOIN customers c ON c.id = vi.customer_id AND c.salon_id = vi.salon_id
        WHERE vi.salon_id = ${salonId}::uuid
          AND vi.subject = 'CUSTOMER'
          AND vi.linked_visit_id IS NULL
      ) follow_ups
      ${this.followCursorSql(parsed)}
      ORDER BY sort_group ASC, sort_value ASC, kind ASC, id ASC
      LIMIT ${limit + 1}
    `;
    const openCount = await this.countCustomerFollowUps(salonId);
    return { ...this.pageFollowUps(rows, limit), openCount };
  }

  async listVipFollowUps(salonId: string, cursor: string | undefined, limit: number, now: Date) {
    const parsed = this.parseFollowCursor(cursor);
    const rows = await this.prisma.client.$queryRaw<FollowUpSqlRow[]>`
      SELECT * FROM (
        SELECT
          'VIP_VISIT_INTENTION'::text AS kind,
          vi.id,
          NULL::uuid AS "customerId",
          NULL::text AS "customerDisplayName",
          CASE WHEN vi.created_by_platform_admin_id IS NULL THEN 'SALON_USER' ELSE 'PLATFORM_ADMIN' END AS "reportedBy",
          vi.report_channel::text AS "reportChannel",
          vi.created_at AS "reportedAt",
          (vi.time_precision::text = 'INSTANT') AS "timeKnown",
          vi.time_precision::text AS "timePrecision",
          vi.agreed_date AS "agreedDate",
          vi.agreed_instant AS "agreedInstant",
          (vi.time_precision::text = 'INSTANT' AND vi.agreed_instant < ${now}::timestamptz) AS "agreedTimePassed",
          NULL::uuid AS "sourceMessageRequestId",
          vi.vip_request_id AS "vipRequestId",
          CASE
            WHEN vi.contact_basis::text IN ('SALON_SUPPLIED', 'ADMIN_AUTHORIZED') THEN vi.disclosed_display_name
            ELSE NULL
          END AS "disclosedDisplayName",
          CASE
            WHEN vi.contact_basis::text IN ('SALON_SUPPLIED', 'ADMIN_AUTHORIZED') THEN vi.disclosed_phone
            ELSE NULL
          END AS "disclosedPhone",
          vi.contact_basis::text AS "contactBasis",
          'SELECT_CUSTOMER_THEN_RECORD_VISIT'::text AS "nextAction",
          CASE vi.time_precision::text WHEN 'INSTANT' THEN 0 WHEN 'DATE' THEN 1 ELSE 2 END AS sort_group,
          CASE vi.time_precision::text
            WHEN 'INSTANT' THEN to_char(vi.agreed_instant AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            WHEN 'DATE' THEN vi.agreed_date::text
            ELSE to_char(vi.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          END AS sort_value
        FROM visit_intentions vi
        WHERE vi.salon_id = ${salonId}::uuid
          AND vi.subject = 'VIP_PROSPECT'
          AND vi.linked_visit_id IS NULL
      ) follow_ups
      ${this.followCursorSql(parsed)}
      ORDER BY sort_group ASC, sort_value ASC, kind ASC, id ASC
      LIMIT ${limit + 1}
    `;
    const counted = await this.prisma.client.visitIntention.count({
      where: { salonId, subject: 'VIP_PROSPECT', linkedVisitId: null },
    });
    return { ...this.pageFollowUps(rows, limit), openCount: counted };
  }

  private async countCustomerFollowUps(salonId: string): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<Array<{ count: bigint }>>`
      SELECT (
        (
          SELECT COUNT(*)
          FROM return_commitments rc
          JOIN message_deliveries md
            ON md.id = rc.source_message_delivery_id AND md.salon_id = rc.salon_id
          WHERE rc.salon_id = ${salonId}::uuid
            AND ${operationallyOpenReturnCommitmentSql}
        ) + (
          SELECT COUNT(*)
          FROM visit_intentions vi
          WHERE vi.salon_id = ${salonId}::uuid
            AND vi.subject = 'CUSTOMER'
            AND vi.linked_visit_id IS NULL
        )
      ) AS count
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private parseFollowCursor(cursor: string | undefined): FollowCursor | undefined {
    const parts = decodeCursor(cursor, 4);
    if (!parts) return undefined;
    const group = parseCursorInteger(parts[0]!, 0, 2);
    const kind = parts[2]!;
    if (kind !== 'RETURN_COMMITMENT' && kind !== 'VISIT_INTENTION' && kind !== 'VIP_VISIT_INTENTION') {
      throw new ValidationError('Invalid cursor');
    }
    return { group, sortValue: parts[1]!, kind, id: parseCursorUuid(parts[3]!) };
  }

  private followCursorSql(cursor: FollowCursor | undefined): Prisma.Sql {
    if (!cursor) return Prisma.empty;
    return Prisma.sql`
      WHERE sort_group > ${cursor.group}
        OR (sort_group = ${cursor.group} AND sort_value > ${cursor.sortValue})
        OR (sort_group = ${cursor.group} AND sort_value = ${cursor.sortValue} AND kind > ${cursor.kind})
        OR (
          sort_group = ${cursor.group}
          AND sort_value = ${cursor.sortValue}
          AND kind = ${cursor.kind}
          AND id > ${cursor.id}::uuid
        )
    `;
  }

  private pageFollowUps(rows: FollowUpSqlRow[], limit: number) {
    const page = toListPage(rows.map(mapFollowUpRow), limit, (row) =>
      encodeCursor([String(row.sortGroup), row.sortValue, row.kind, row.id]),
    );
    return {
      items: page.items.map(({ sortGroup: _sortGroup, sortValue: _sortValue, ...item }) => item),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

type FollowCursor = { group: number; sortValue: string; kind: string; id: string };

type FollowUpSqlRow = {
  kind: string;
  id: string;
  customerId: string | null;
  customerDisplayName: string | null;
  reportedBy: string;
  reportChannel: string | null;
  reportedAt: Date;
  timeKnown: boolean;
  timePrecision: string;
  agreedDate: Date | null;
  agreedInstant: Date | null;
  agreedTimePassed: boolean;
  sourceMessageRequestId: string | null;
  vipRequestId: string | null;
  disclosedDisplayName: string | null;
  disclosedPhone: string | null;
  contactBasis: string | null;
  nextAction: string;
  sort_group: number;
  sort_value: string;
};

function authorizedContact(basis: string | null | undefined) {
  return basis === 'SALON_SUPPLIED' || basis === 'ADMIN_AUTHORIZED';
}

function mapFollowUpRow(row: FollowUpSqlRow) {
  const showContact = row.kind === 'VIP_VISIT_INTENTION' && authorizedContact(row.contactBasis);
  return {
    kind: row.kind,
    id: row.id,
    customerId: row.customerId,
    customerDisplayName: row.customerDisplayName,
    reportedBy: row.reportedBy,
    reportChannel: row.reportChannel,
    reportedAt: row.reportedAt.toISOString(),
    timeKnown: row.timeKnown,
    timePrecision: row.timePrecision,
    agreedDate: formatAgreedDate(row.agreedDate),
    agreedInstant: row.agreedInstant?.toISOString() ?? null,
    agreedTimePassed: row.timeKnown ? row.agreedTimePassed : false,
    sourceMessageRequestId: row.sourceMessageRequestId,
    vipRequestId: row.vipRequestId,
    identityDisclosure:
      row.kind === 'VIP_VISIT_INTENTION' ? (showContact ? row.contactBasis : 'WITHHELD') : null,
    disclosedDisplayName: showContact ? row.disclosedDisplayName : null,
    disclosedPhone: showContact ? row.disclosedPhone : null,
    nextAction: row.nextAction,
    sortGroup: row.sort_group,
    sortValue: row.sort_value,
  };
}

export function toVisitIntentionReadModel(
  row: VisitIntentionRecord,
  audience: IntentionAudience,
  now: Date,
) {
  const timeKnown = row.timePrecision === 'INSTANT';
  const showContact = row.subject === 'VIP_PROSPECT' && authorizedContact(row.contactBasis);
  return {
    id: row.id,
    subject: row.subject,
    customerId: row.customerId,
    vipRequestId: row.vipRequestId,
    ...(audience === 'SALON' ? {} : { vipRequestRecipientId: row.vipRequestRecipientId }),
    reportedBy: row.createdByPlatformAdminId ? 'PLATFORM_ADMIN' : 'SALON_USER',
    reportChannel: row.reportChannel,
    reportedAt: row.createdAt.toISOString(),
    timePrecision: row.timePrecision,
    timeKnown,
    agreedDate: formatAgreedDate(row.agreedDate),
    agreedInstant: row.agreedInstant?.toISOString() ?? null,
    agreedTimePassed: timeKnown && row.agreedInstant !== null && row.agreedInstant.getTime() < now.getTime(),
    sourceMessageRequestId: row.sourceMessageRequestId,
    identityDisclosure: row.subject === 'VIP_PROSPECT' ? (showContact ? row.contactBasis : 'WITHHELD') : null,
    disclosedDisplayName: showContact ? row.disclosedDisplayName : null,
    disclosedPhone: showContact ? row.disclosedPhone : null,
    linkedVisitId: row.linkedVisitId,
    linkedCustomerId: row.linkedCustomerId,
    operationallyOpen: row.linkedVisitId === null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
