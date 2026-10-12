import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  assertCurrencyIrr,
  ConflictError,
  createId,
  CustomerPhoneExistsError,
  ForbiddenError,
  formatMoneyString,
  NotFoundError,
  parseMoneyString,
  ValidationError,
  type AuthenticatedPrincipal,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import { createCustomerInTransaction, requireCustomerIdentity } from '../customer/create-customer-record';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  requireIdempotencyKey,
} from '../infrastructure/http/idempotency';
import { parseAbsoluteInstant } from '../infrastructure/http/date-input';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { parseCompletedVisitedAt } from '../visit/visited-at';
import { RecordCompletedVisit } from '../visit/record-completed-visit';
import { VisitRepository } from '../visit/visit.repository';
import type {
  ArriveVisitIntentionDto,
  CreateAdminVipVisitIntentionDto,
  CreateCustomerVisitIntentionDto,
  CreateSalonVipVisitIntentionDto,
  LinkVisitIntentionDto,
  ListVisitIntentionsQueryDto,
  UpdateVisitIntentionDto,
} from './visit-intention.dto';
import {
  VISIT_INTENTION_ARRIVE,
  VISIT_INTENTION_CREATE_CUSTOMER,
  VISIT_INTENTION_CREATE_VIP_ADMIN,
  VISIT_INTENTION_CREATE_VIP_SALON,
  VISIT_INTENTION_LINK_VISIT,
  VISIT_INTENTION_UPDATE,
  visitIntentionRequestHash,
} from './visit-intention.idempotency';
import {
  evidenceForIntentions,
  VisitIntentionRepository,
  toVisitIntentionReadModel,
  type IntentionAudience,
  type VisitIntentionRecord,
} from './visit-intention.repository';
import {
  parseDisclosedDisplayName,
  parseDisclosedPhone,
  parseVisitIntentionTime,
  timeCanonical,
} from './visit-intention.time';

const PAGE_DEFAULT = 20;

type Actor =
  | { kind: 'SALON_USER'; userId: string }
  | { kind: 'PLATFORM_ADMIN'; adminId: string };

@Injectable()
export class CreateCustomerVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    input: CreateCustomerVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    return createCustomerIntention(this.prisma, this.intentions, {
      salonId: principal.tenantId,
      customerId,
      input,
      actor: { kind: 'SALON_USER', userId: principal.userId },
      audience: 'SALON',
      reportChannel: 'SALON_STAFF',
      rawKey,
    });
  }
}

@Injectable()
export class AdminCreateCustomerVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    customerId: string,
    input: CreateCustomerVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    const customer = await this.prisma.client.customer.findUnique({
      where: { id: customerId },
      select: { id: true, salonId: true },
    });
    if (!customer) throw new NotFoundError('Customer not found');
    return createCustomerIntention(this.prisma, this.intentions, {
      salonId: customer.salonId,
      customerId: customer.id,
      input,
      actor: { kind: 'PLATFORM_ADMIN', adminId: admin.adminId },
      audience: 'ADMIN',
      reportChannel: 'TOLD_PLATFORM_ADMIN',
      rawKey,
    });
  }
}

@Injectable()
export class CreateSalonVipVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  execute(
    principal: AuthenticatedPrincipal,
    vipRequestId: string,
    input: CreateSalonVipVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    const time = parseVisitIntentionTime(input.time);
    const disclosedDisplayName = parseDisclosedDisplayName(input.disclosedDisplayName);
    const disclosedPhone = parseDisclosedPhone(input.disclosedPhone);
    if (!disclosedDisplayName && !disclosedPhone) {
      throw new ValidationError('A salon VIP intention needs the name or phone the prospect gave the salon');
    }
    const idempotencyKey = requireIdempotencyKey(rawKey);
    const requestHash = visitIntentionRequestHash(
      VISIT_INTENTION_CREATE_VIP_SALON,
      `${vipRequestId}:${timeCanonical(time)}:${disclosedDisplayName ?? ''}:${disclosedPhone ?? ''}`,
    );
    return writeIntention({
      prisma: this.prisma,
      intentions: this.intentions,
      salonId: principal.tenantId,
      actor: { kind: 'SALON_USER', userId: principal.userId },
      actorId: principal.userId,
      operation: VISIT_INTENTION_CREATE_VIP_SALON,
      idempotencyKey,
      requestHash,
      audience: 'SALON',
      insert: async (tx, id, now) => {
        const request = await tx.vipRequest.findFirst({
          where: { id: vipRequestId, salonId: principal.tenantId },
          select: { id: true },
        });
        if (!request) throw new NotFoundError('VIP request not found');
        await this.intentions.insert(tx, {
          id,
          salonId: principal.tenantId,
          subject: 'VIP_PROSPECT',
          customerId: null,
          sourceMessageRequestId: null,
          vipRequestId: request.id,
          vipRequestRecipientId: null,
          disclosedDisplayName,
          disclosedPhone,
          contactBasis: 'SALON_SUPPLIED',
          time,
          reportChannel: 'INBOUND_TO_SALON',
          actor: { kind: 'SALON_USER', userId: principal.userId },
          now,
        });
      },
    });
  }
}

@Injectable()
export class AdminCreateVipVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    vipRequestId: string,
    recipientId: string,
    input: CreateAdminVipVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    const legacyTimeOnly =
      input.disclosedDisplayName === undefined &&
      input.disclosedPhone === undefined &&
      input.prospectAuthorizedSharingWithSalon === undefined;
    if (!legacyTimeOnly && input.prospectAuthorizedSharingWithSalon !== true) {
      throw new ValidationError('The prospect must authorize sharing this name and phone with the salon');
    }
    const disclosedDisplayName = legacyTimeOnly ? null : parseDisclosedDisplayName(input.disclosedDisplayName);
    const disclosedPhone = legacyTimeOnly ? null : parseDisclosedPhone(input.disclosedPhone);
    if (!legacyTimeOnly && (!disclosedDisplayName || !disclosedPhone)) {
      throw new ValidationError('Admin disclosure needs both the name and phone the prospect authorized for this salon');
    }
    const request = await this.prisma.client.vipRequest.findUnique({
      where: { id: vipRequestId },
      select: { id: true, salonId: true },
    });
    if (!request) throw new NotFoundError('VIP request not found');
    const time = parseVisitIntentionTime(input.time);
    const idempotencyKey = requireIdempotencyKey(rawKey);
    const requestHash = visitIntentionRequestHash(
      VISIT_INTENTION_CREATE_VIP_ADMIN,
      legacyTimeOnly
        ? `${request.id}:${recipientId}:${timeCanonical(time)}`
        : `${request.id}:${recipientId}:${timeCanonical(time)}:${disclosedDisplayName}:${disclosedPhone}:authorized`,
    );
    return writeIntention({
      prisma: this.prisma,
      intentions: this.intentions,
      salonId: request.salonId,
      actor: { kind: 'PLATFORM_ADMIN', adminId: admin.adminId },
      actorId: admin.adminId,
      operation: VISIT_INTENTION_CREATE_VIP_ADMIN,
      idempotencyKey,
      requestHash,
      audience: 'ADMIN',
      insert: async (tx, id, now) => {
        const recipient = await tx.vipRequestRecipient.findFirst({
          where: { id: recipientId, vipRequestId: request.id, salonId: request.salonId },
          select: { id: true },
        });
        if (!recipient) throw new NotFoundError('VIP recipient not found');
        await this.intentions.insert(tx, {
          id,
          salonId: request.salonId,
          subject: 'VIP_PROSPECT',
          customerId: null,
          sourceMessageRequestId: null,
          vipRequestId: request.id,
          vipRequestRecipientId: recipient.id,
          disclosedDisplayName,
          disclosedPhone,
          contactBasis: legacyTimeOnly ? 'WITHHELD' : 'ADMIN_AUTHORIZED',
          time,
          reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
          actor: { kind: 'PLATFORM_ADMIN', adminId: admin.adminId },
          now,
        });
      },
    });
  }
}

@Injectable()
export class ListSalonVipVisitIntentionsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, vipRequestId: string, query: ListVisitIntentionsQueryDto) {
    const request = await this.prisma.client.vipRequest.findFirst({
      where: { id: vipRequestId, salonId: principal.tenantId },
      select: { id: true },
    });
    if (!request) throw new NotFoundError('VIP request not found');
    const page = await this.intentions.listForVipRequest(
      principal.tenantId,
      request.id,
      query.cursor,
      query.limit ?? PAGE_DEFAULT,
    );
    const now = new Date();
    return {
      items: await presentRows(this.prisma.client, page.items, 'SALON', now),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class UpdateVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  execute(
    principal: AuthenticatedPrincipal,
    id: string,
    input: UpdateVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    return correctTime(this.prisma, this.intentions, {
      salonId: principal.tenantId,
      id,
      input,
      actor: { kind: 'SALON_USER', userId: principal.userId },
      actorId: principal.userId,
      audience: 'SALON',
      rawKey,
    });
  }
}

@Injectable()
export class AdminUpdateVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    id: string,
    input: UpdateVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    const existing = await this.prisma.client.visitIntention.findUnique({
      where: { id },
      select: { salonId: true },
    });
    if (!existing) throw new NotFoundError('Visit intention not found');
    return correctTime(this.prisma, this.intentions, {
      salonId: existing.salonId,
      id,
      input,
      actor: { kind: 'PLATFORM_ADMIN', adminId: admin.adminId },
      actorId: admin.adminId,
      audience: 'ADMIN',
      rawKey,
    });
  }
}

@Injectable()
export class ListCustomerVisitIntentionsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string, query: ListVisitIntentionsQueryDto) {
    const exists = await this.prisma.client.customer.findFirst({
      where: { id: customerId, salonId: principal.tenantId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Customer not found');
    const page = await this.intentions.listForCustomer(
      principal.tenantId,
      customerId,
      query.cursor,
      query.limit ?? PAGE_DEFAULT,
    );
    const now = new Date();
    return {
      items: await presentRows(this.prisma.client, page.items, 'SALON', now),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class ListFollowUpsUseCase {
  constructor(private readonly intentions: VisitIntentionRepository) {}

  customers(principal: AuthenticatedPrincipal, query: ListVisitIntentionsQueryDto) {
    return this.intentions.listCustomerFollowUps(
      principal.tenantId,
      query.cursor,
      query.limit ?? PAGE_DEFAULT,
      new Date(),
    );
  }

  vip(principal: AuthenticatedPrincipal, query: ListVisitIntentionsQueryDto) {
    return this.intentions.listVipFollowUps(
      principal.tenantId,
      query.cursor,
      query.limit ?? PAGE_DEFAULT,
      new Date(),
    );
  }
}

@Injectable()
export class ArriveVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
    private readonly customers: CustomerRepository,
    private readonly recordVisit: RecordCompletedVisit,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    id: string,
    input: ArriveVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawKey);
    const visitedAt = parseCompletedVisitedAt(input.visitedAt);
    const sale = input.sale
      ? {
          serviceId: input.sale.serviceId,
          amount: formatMoneyString(parseMoneyString(input.sale.amount)),
          currency: assertCurrencyIrr(input.sale.currency),
        }
      : null;
    if (sale && principal.role === 'STAFF') {
      throw new ForbiddenError();
    }
    if (input.customerId && input.newCustomer) {
      throw new ValidationError('Choose an existing customer or enter a new one, not both');
    }
    const newCustomer = input.newCustomer ? requireCustomerIdentity(input.newCustomer) : null;
    const customerCanon = newCustomer
      ? `new:${createHash('sha256').update(`${newCustomer.firstName}\n${newCustomer.lastName}\n${newCustomer.phoneNumber}`).digest('hex')}`
      : (input.customerId ?? '');
    const requestHash = visitIntentionRequestHash(
      VISIT_INTENTION_ARRIVE,
      `${id}:${customerCanon}:${visitedAt.toISOString()}:${sale ? `${sale.serviceId}:${sale.amount}:${sale.currency}` : 'none'}`,
    );
    const visitId = createId();
    const transactionId = createId();
    const now = new Date();
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: VISIT_INTENTION_ARRIVE,
          key: idempotencyKey,
          requestHash,
          resourceType: 'visit_intention',
          resourceId: id,
        });
        if (!claim.inserted) {
          return replay(tx, this.intentions, principal.tenantId, principal.userId, VISIT_INTENTION_ARRIVE, idempotencyKey, requestHash, 'SALON');
        }
        const locked = await this.intentions.lockById(tx, principal.tenantId, id);
        if (!locked) throw new NotFoundError('Visit intention not found');
        if (locked.linkedVisitId) {
          throw new ConflictError('This visit intention is already linked to a recorded visit');
        }
        const customerId = await customerForArrival(tx, principal, locked, input.customerId, newCustomer);
        const customer = await this.customers.lockByIdForUpdate(tx, principal.tenantId, customerId);
        if (!customer) throw new NotFoundError('Customer not found');
        if (sale) {
          await this.recordVisit.createWithSale(tx, {
            principal,
            customerId,
            visitedAt,
            serviceId: sale.serviceId,
            amount: sale.amount,
            currency: sale.currency,
            visitId,
            transactionId,
            now,
          });
        } else {
          await this.recordVisit.create(tx, {
            principal,
            customerId,
            visitedAt,
            visitId,
            now,
          });
        }
        const linked = await this.intentions.linkVisit(tx, {
          salonId: principal.tenantId,
          id,
          visitId,
          customerId,
          actor: { kind: 'SALON_USER', userId: principal.userId },
          now,
        });
        if (!linked) {
          throw new ConflictError('This visit intention is already linked to a recorded visit');
        }
        const row = await this.intentions.findById(principal.tenantId, id, tx);
        if (!row) throw new NotFoundError('Visit intention not found');
        return presentRow(tx, row, 'SALON', now);
      });
    } catch (error: unknown) {
      if (error instanceof CustomerPhoneExistsError) throw error;
      rethrowIntentionError(error);
    }
  }
}

@Injectable()
export class LinkVisitIntentionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentions: VisitIntentionRepository,
    private readonly visits: VisitRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    id: string,
    input: LinkVisitIntentionDto,
    rawKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawKey);
    const requestHash = visitIntentionRequestHash(VISIT_INTENTION_LINK_VISIT, `${id}:${input.visitId}`);
    const now = new Date();
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: VISIT_INTENTION_LINK_VISIT,
          key: idempotencyKey,
          requestHash,
          resourceType: 'visit_intention',
          resourceId: id,
        });
        if (!claim.inserted) {
          return replay(tx, this.intentions, principal.tenantId, principal.userId, VISIT_INTENTION_LINK_VISIT, idempotencyKey, requestHash, 'SALON');
        }
        const locked = await this.intentions.lockById(tx, principal.tenantId, id);
        if (!locked) throw new NotFoundError('Visit intention not found');
        if (locked.linkedVisitId === input.visitId) {
          return presentRow(tx, locked, 'SALON', now);
        }
        if (locked.linkedVisitId) {
          throw new ConflictError('This visit intention is already linked to a recorded visit');
        }
        const visit = await this.visits.findById(principal.tenantId, input.visitId, tx);
        if (!visit) throw new NotFoundError('Visit not found');
        if (locked.subject === 'CUSTOMER' && visit.customerId !== locked.customerId) {
          throw new ValidationError('Visit belongs to a different customer');
        }
        const linked = await this.intentions.linkVisit(tx, {
          salonId: principal.tenantId,
          id,
          visitId: visit.id,
          customerId: visit.customerId,
          actor: { kind: 'SALON_USER', userId: principal.userId },
          now,
        });
        if (!linked) {
          throw new ConflictError('This visit intention is already linked to a recorded visit');
        }
        const row = await this.intentions.findById(principal.tenantId, id, tx);
        if (!row) throw new NotFoundError('Visit intention not found');
        return presentRow(tx, row, 'SALON', now);
      });
    } catch (error: unknown) {
      rethrowIntentionError(error);
    }
  }
}

async function createCustomerIntention(
  prisma: PrismaService,
  intentions: VisitIntentionRepository,
  input: {
    salonId: string;
    customerId: string;
    input: CreateCustomerVisitIntentionDto;
    actor: Actor;
    audience: IntentionAudience;
    reportChannel: 'SALON_STAFF' | 'TOLD_PLATFORM_ADMIN';
    rawKey: string | string[] | undefined;
  },
) {
  const time = parseVisitIntentionTime(input.input.time);
  const idempotencyKey = requireIdempotencyKey(input.rawKey);
  const actorId = input.actor.kind === 'SALON_USER' ? input.actor.userId : input.actor.adminId;
  const requestHash = visitIntentionRequestHash(
    VISIT_INTENTION_CREATE_CUSTOMER,
    `${input.customerId}:${timeCanonical(time)}:${input.input.sourceMessageRequestId ?? ''}`,
  );
  return writeIntention({
    prisma,
    intentions,
    salonId: input.salonId,
    actor: input.actor,
    actorId,
    operation: VISIT_INTENTION_CREATE_CUSTOMER,
    idempotencyKey,
    requestHash,
    audience: input.audience,
    insert: async (tx, id, now) => {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, salonId: input.salonId },
        select: { id: true },
      });
      if (!customer) throw new NotFoundError('Customer not found');
      let sourceMessageRequestId: string | null = null;
      if (input.input.sourceMessageRequestId) {
        const message = await tx.messageRequest.findFirst({
          where: { id: input.input.sourceMessageRequestId, salonId: input.salonId },
          select: { id: true, customerId: true, vipRequestId: true },
        });
        if (!message) throw new NotFoundError('Message not found');
        if (message.vipRequestId || message.customerId !== customer.id) {
          throw new ValidationError('Message is not a customer message for this customer');
        }
        sourceMessageRequestId = message.id;
      }
      await intentions.insert(tx, {
        id,
        salonId: input.salonId,
        subject: 'CUSTOMER',
        customerId: customer.id,
        sourceMessageRequestId,
        vipRequestId: null,
        vipRequestRecipientId: null,
        disclosedDisplayName: null,
        disclosedPhone: null,
        contactBasis: 'WITHHELD',
        time,
        reportChannel: input.reportChannel,
        actor: input.actor,
        now,
      });
    },
  });
}

async function correctTime(
  prisma: PrismaService,
  intentions: VisitIntentionRepository,
  input: {
    salonId: string;
    id: string;
    input: UpdateVisitIntentionDto;
    actor: Actor;
    actorId: string;
    audience: IntentionAudience;
    rawKey: string | string[] | undefined;
  },
) {
  const time = parseVisitIntentionTime(input.input.time);
  const expectedUpdatedAt = parseAbsoluteInstant(input.input.updatedAt, 'updatedAt');
  const correctContact = input.input.correctDisclosedContact === true;
  const disclosedDisplayName = correctContact
    ? parseDisclosedDisplayName(input.input.disclosedDisplayName)
    : null;
  const disclosedPhone = correctContact ? parseDisclosedPhone(input.input.disclosedPhone) : null;
  const idempotencyKey = requireIdempotencyKey(input.rawKey);
  const contactAttestation = input.input.prospectAuthorizedSharingWithSalon === true ? 'authorized' : 'unattested';
  const requestHash = visitIntentionRequestHash(
    VISIT_INTENTION_UPDATE,
    correctContact
      ? `${input.id}:${timeCanonical(time)}:${expectedUpdatedAt.toISOString()}:contact:${disclosedDisplayName ?? ''}:${disclosedPhone ?? ''}:${contactAttestation}`
      : `${input.id}:${timeCanonical(time)}:${expectedUpdatedAt.toISOString()}`,
  );
  const now = new Date();
  try {
    return await prisma.client.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        id: createId(),
        tenantId: input.salonId,
        actorId: input.actorId,
        operation: VISIT_INTENTION_UPDATE,
        key: idempotencyKey,
        requestHash,
        resourceType: 'visit_intention',
        resourceId: input.id,
      });
      if (!claim.inserted) {
        return replay(tx, intentions, input.salonId, input.actorId, VISIT_INTENTION_UPDATE, idempotencyKey, requestHash, input.audience);
      }
      const locked = await intentions.lockById(tx, input.salonId, input.id);
      if (!locked) throw new NotFoundError('Visit intention not found');
      if (
        correctContact &&
        locked.contactBasis === 'ADMIN_AUTHORIZED' &&
        input.input.prospectAuthorizedSharingWithSalon !== true
      ) {
        throw new ValidationError('The prospect must authorize sharing the corrected name and phone with the salon');
      }
      const corrected = await intentions.correctTime(tx, {
        salonId: input.salonId,
        id: input.id,
        time,
        expectedUpdatedAt,
        actor: input.actor,
        now,
        previous: locked,
      });
      if (!corrected) {
        throw new ConflictError('Visit intention was updated by someone else');
      }
      if (correctContact) {
        const current = await intentions.findById(input.salonId, input.id, tx);
        if (!current) throw new NotFoundError('Visit intention not found');
        await intentions.correctDisclosedContact(tx, {
          salonId: input.salonId,
          id: input.id,
          disclosedDisplayName,
          disclosedPhone,
          actor: input.actor,
          now,
          previous: current,
        });
      }
      const row = await intentions.findById(input.salonId, input.id, tx);
      if (!row) throw new NotFoundError('Visit intention not found');
      return presentRow(tx, row, input.audience, now);
    });
  } catch (error: unknown) {
    rethrowIntentionError(error);
  }
}

async function writeIntention(input: {
  prisma: PrismaService;
  intentions: VisitIntentionRepository;
  salonId: string;
  actor: Actor;
  actorId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  audience: IntentionAudience;
  insert: (tx: Prisma.TransactionClient, id: string, now: Date) => Promise<void>;
}) {
  const id = createId();
  const now = new Date();
  try {
    return await input.prisma.client.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        id: createId(),
        tenantId: input.salonId,
        actorId: input.actorId,
        operation: input.operation,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: 'visit_intention',
        resourceId: id,
      });
      if (!claim.inserted) {
        return replay(
          tx,
          input.intentions,
          input.salonId,
          input.actorId,
          input.operation,
          input.idempotencyKey,
          input.requestHash,
          input.audience,
        );
      }
      await input.insert(tx, id, now);
      const row = await input.intentions.findById(input.salonId, id, tx);
      if (!row) throw new NotFoundError('Visit intention not found');
      return presentRow(tx, row, input.audience, now);
    });
  } catch (error: unknown) {
    rethrowIntentionError(error);
  }
}

async function replay(
  tx: Prisma.TransactionClient,
  intentions: VisitIntentionRepository,
  salonId: string,
  actorId: string,
  operation: string,
  key: string,
  requestHash: string,
  audience: IntentionAudience,
) {
  const existing = await findIdempotencyRecord(tx, { tenantId: salonId, actorId, operation, key });
  if (!existing) throw new NotFoundError('Visit intention not found');
  assertSameIdempotentRequest(existing.requestHash, requestHash);
  const row = await intentions.findById(salonId, existing.resourceId, tx);
  if (!row) throw new NotFoundError('Visit intention not found');
  return presentRow(tx, row, audience, new Date());
}

async function presentRows(
  db: Prisma.TransactionClient | PrismaService['client'],
  rows: VisitIntentionRecord[],
  audience: IntentionAudience,
  now: Date,
) {
  const evidence = await evidenceForIntentions(db, rows);
  return rows.map((row) => toVisitIntentionReadModel(row, audience, now, evidence.get(row.id)));
}

function presentRow(
  db: Prisma.TransactionClient | PrismaService['client'],
  row: VisitIntentionRecord,
  audience: IntentionAudience,
  now: Date,
) {
  return presentRows(db, [row], audience, now).then((items) => items[0]!);
}

async function customerForArrival(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedPrincipal,
  row: VisitIntentionRecord,
  requestedCustomerId: string | undefined,
  newCustomer: { firstName: string; lastName: string; phoneNumber: string } | null,
): Promise<string> {
  if (row.subject === 'CUSTOMER') {
    if (newCustomer) throw new ValidationError('This intention already belongs to a customer');
    if (requestedCustomerId && requestedCustomerId !== row.customerId) {
      throw new ValidationError('Customer does not match this visit intention');
    }
    return row.customerId!;
  }
  if (requestedCustomerId) return requestedCustomerId;
  if (!newCustomer) {
    throw new ValidationError('Choose an existing customer or enter the customer details with the visit');
  }
  const created = await createCustomerInTransaction(tx, {
    salonId: principal.tenantId,
    actorId: principal.userId,
    identity: newCustomer,
    now: new Date(),
    phoneConflict: 'explicit-choice',
  });
  return created.id;
}

function prismaUniqueHint(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = error.meta ?? {};
  return JSON.stringify({
    target: meta.target,
    constraint: meta.constraint,
    modelName: meta.modelName,
    message: error.message,
  }).toLowerCase();
}

export function rethrowIntentionError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const hint = prismaUniqueHint(error);
    if (hint.includes('phone_number') || hint.includes('phonenumber')) {
      throw new CustomerPhoneExistsError();
    }
    if (
      hint.includes('one_open_customer') ||
      (hint.includes('customer_id') && !hint.includes('linked_visit') && !hint.includes('vip_request_recipient'))
    ) {
      throw new ConflictError('An open visit intention already exists for this customer');
    }
    if (hint.includes('one_open_vip_recipient') || hint.includes('vip_request_recipient')) {
      throw new ConflictError('An open visit intention already exists for this VIP recipient');
    }
    if (hint.includes('linked_visit')) {
      throw new ConflictError('This visit is already linked to a visit intention');
    }
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    throw new NotFoundError('Related record not found');
  }
  const mapped = mapPrismaError(error);
  if (mapped) throw mapped;
  throw error;
}
