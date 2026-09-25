import { Injectable } from '@nestjs/common';
import { getBaleSafirSettings } from '@salon/config';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  VIP_BALE_NOT_AVAILABLE_MESSAGE,
  createId,
  DOMAIN_EVENT_TYPES,
  isCanonicalMessageSent,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { AdminMessageQueueQueryDto } from './admin-message.dto';
import { toAdminMessageItem, type AdminMessageRow } from './admin-message.mapper';
import { toReturnCommitmentSummary, type ReturnCommitmentRow } from '../return-commitment/return-commitment.mapper';
import { ReturnCommitmentRepository } from '../return-commitment/return-commitment.repository';
import {
  ADMIN_MESSAGE_LIST_LIMIT,
  AdminMessageRepository,
  parseAdminCursor,
} from './admin-message.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class ListAdminMessageQueueUseCase {
  constructor(
    private readonly messages: AdminMessageRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(query: AdminMessageQueueQueryDto) {
    if (query.salonId && !isUuid(query.salonId)) {
      throw new ValidationError('Invalid salon id');
    }
    if (query.customerId && !isUuid(query.customerId)) {
      throw new ValidationError('Invalid customer id');
    }
    const rows = (await this.messages.list({
      status: query.status,
      mode: query.mode,
      salonId: query.salonId,
      customerId: query.customerId,
      cursor: parseAdminCursor(query.cursor),
    })) as AdminMessageRow[];
    const page = toListPage(rows, ADMIN_MESSAGE_LIST_LIMIT, (row) =>
      encodeCursor([row.requestedAt.toISOString(), row.id]),
    );
    return {
      items: page.items.map((row) => toAdminMessageItem(row, this.config.values, null)),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class GetAdminMessageUseCase {
  constructor(
    private readonly messages: AdminMessageRepository,
    private readonly commitments: ReturnCommitmentRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(id: string) {
    const row = await this.messages.findById(id);
    if (!row) {
      throw new NotFoundError('Message not found');
    }
    const commitment = await this.commitments.findBySourceRequestId(row.salonId, row.id);
    return toAdminMessageItem(
      row as AdminMessageRow,
      this.config.values,
      commitment ? toReturnCommitmentSummary(commitment as ReturnCommitmentRow) : null,
    );
  }
}

@Injectable()
export class SelectMessageDeliveryModeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: AdminMessageRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(admin: PlatformAdminPrincipal, id: string, mode: 'BALE' | 'MANUAL') {
    const now = new Date();
    const deliveryId = createId();
    const providerReady = getBaleSafirSettings(this.config.values) !== null;

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.messageRequest.findFirst({ where: { id } });
        if (!existing) {
          throw new NotFoundError('Message not found');
        }
        if (!existing.recipientPhoneNumber) {
          throw new ConflictError('Message destination cannot be verified');
        }
        if (mode === 'BALE' && existing.vipRequestId) {
          throw new ConflictError(VIP_BALE_NOT_AVAILABLE_MESSAGE);
        }

        const claimed = await tx.messageRequest.updateMany({
          where: { id, status: 'QUEUED' },
          data: { status: 'DISPATCHED', updatedAt: now },
        });
        if (claimed.count === 0) {
          throw new ConflictError('Message is not in a state that allows this action');
        }

        const request = await tx.messageRequest.findFirstOrThrow({
          where: { id },
        });
        if (mode === 'BALE' && request.vipRequestId) {
          throw new ConflictError(VIP_BALE_NOT_AVAILABLE_MESSAGE);
        }

        await tx.messageDelivery.create({
          data: {
            id: deliveryId,
            salonId: request.salonId,
            messageRequestId: request.id,
            customerId: request.customerId,
            actionId: request.actionId,
            mode,
            provider: mode === 'BALE' ? 'BALE_SAFIR' : null,
            channel: 'TEXT',
            status: 'PENDING',
            providerRequestId: deliveryId,
            createdBy: request.createdByUserId,
            dispatchedByAdminId: admin.adminId,
            updatedAt: now,
          },
        });

        if (mode === 'BALE' && providerReady) {
          await tx.outboxEvent.create({
            data: {
              id: createId(),
              tenantId: request.salonId,
              eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated,
              dedupeKey: `message-delivery:${deliveryId}:0`,
              payload: {
                messageDeliveryId: deliveryId,
                messageRequestId: request.id,
                salonId: request.salonId,
                executionGeneration: 0,
              },
            },
          });
        }

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: request.salonId,
            actorId: admin.adminId,
            action: 'MESSAGE_DELIVERY_MODE_SELECTED',
            resource: 'message_request',
            resourceId: request.id,
            result: 'SUCCESS',
            metadata: {
              mode,
              deliveryId,
              providerReady: mode === 'BALE' ? providerReady : undefined,
            },
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Message is not in a state that allows this action');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }

    const row = await this.messages.findById(id);
    if (!row) {
      throw new NotFoundError('Message not found');
    }
    return toAdminMessageItem(row as AdminMessageRow, this.config.values);
  }
}

@Injectable()
export class MarkManualMessageSentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: AdminMessageRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(admin: PlatformAdminPrincipal, id: string) {
    const now = new Date();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM message_requests WHERE id = ${id}::uuid FOR UPDATE`;
        const request = await tx.messageRequest.findFirst({ where: { id } });
        if (!request) {
          throw new NotFoundError('Message not found');
        }
        const delivery = await tx.messageDelivery.findFirst({
          where: { messageRequestId: id, salonId: request.salonId },
        });
        if (isCanonicalMessageSent(delivery?.status, delivery?.submittedAt)) {
          return;
        }
        if (!request.recipientPhoneNumber) {
          throw new ConflictError('Message destination cannot be verified');
        }
        if (request.status === 'CANCELLED') {
          throw new ConflictError('Message is not in a state that allows this action');
        }

        if (request.status === 'QUEUED' && !delivery) {
          const claimed = await tx.messageRequest.updateMany({
            where: { id, salonId: request.salonId, status: 'QUEUED' },
            data: { status: 'DISPATCHED', updatedAt: now },
          });
          if (claimed.count === 0) {
            throw new ConflictError('Message is not in a state that allows this action');
          }
          const deliveryId = createId();
          await tx.messageDelivery.create({
            data: {
              id: deliveryId,
              salonId: request.salonId,
              messageRequestId: request.id,
              customerId: request.customerId,
              actionId: request.actionId,
              mode: 'MANUAL',
              provider: null,
              channel: 'TEXT',
              status: 'SENT',
              submittedAt: now,
              providerRequestId: deliveryId,
              createdBy: request.createdByUserId,
              dispatchedByAdminId: admin.adminId,
              fulfilledByAdminId: admin.adminId,
              updatedAt: now,
            },
          });
          const sent = await tx.messageRequest.updateMany({
            where: { id, salonId: request.salonId, status: 'DISPATCHED' },
            data: { status: 'SENT', updatedAt: now },
          });
          if (sent.count === 0) {
            throw new ConflictError('Message is not in a state that allows this action');
          }
          await tx.outboxEvent.create({
            data: {
              id: createId(),
              tenantId: request.salonId,
              eventType: DOMAIN_EVENT_TYPES.MessageSent,
              payload: {
                messageRequestId: id,
                messageDeliveryId: deliveryId,
                salonId: request.salonId,
                mode: 'MANUAL',
              },
            },
          });
          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: request.salonId,
              actorId: admin.adminId,
              action: 'MESSAGE_DELIVERY_MODE_SELECTED',
              resource: 'message_request',
              resourceId: request.id,
              result: 'SUCCESS',
              metadata: { mode: 'MANUAL', deliveryId },
            },
          });
          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: request.salonId,
              actorId: admin.adminId,
              action: 'MESSAGE_MANUALLY_SENT',
              resource: 'message_delivery',
              resourceId: deliveryId,
              result: 'SUCCESS',
              metadata: { messageRequestId: id, mode: 'MANUAL', status: 'SENT' },
            },
          });
          return;
        }

        if (!delivery || delivery.mode !== 'MANUAL') {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        const movedRequest = await tx.messageRequest.updateMany({
          where: { id, salonId: request.salonId, status: 'DISPATCHED' },
          data: { status: 'SENT', updatedAt: now },
        });
        if (movedRequest.count === 0) {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        const moved = await tx.messageDelivery.updateMany({
          where: {
            id: delivery.id,
            salonId: delivery.salonId,
            mode: 'MANUAL',
            status: 'PENDING',
          },
          data: {
            status: 'SENT',
            submittedAt: now,
            failedAt: null,
            failureCode: null,
            fulfilledByAdminId: admin.adminId,
            updatedAt: now,
          },
        });
        if (moved.count === 0) {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: request.salonId,
            eventType: DOMAIN_EVENT_TYPES.MessageSent,
            payload: {
              messageRequestId: id,
              messageDeliveryId: delivery.id,
              salonId: request.salonId,
              mode: 'MANUAL',
            },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: request.salonId,
            actorId: admin.adminId,
            action: 'MESSAGE_MANUALLY_SENT',
            resource: 'message_delivery',
            resourceId: delivery.id,
            result: 'SUCCESS',
            metadata: { messageRequestId: id, mode: 'MANUAL', status: 'SENT' },
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }

    const row = await this.messages.findById(id);
    if (!row) {
      throw new NotFoundError('Message not found');
    }
    return toAdminMessageItem(row as AdminMessageRow, this.config.values);
  }
}

@Injectable()
export class CancelAdminMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: AdminMessageRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(admin: PlatformAdminPrincipal, id: string) {
    const now = new Date();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const request = await tx.messageRequest.findFirst({ where: { id } });
        if (!request) {
          throw new NotFoundError('Message not found');
        }
        if (request.status === 'CANCELLED') {
          return;
        }
        const delivery = await tx.messageDelivery.findFirst({
          where: { messageRequestId: id, salonId: request.salonId },
        });
        if (isCanonicalMessageSent(delivery?.status, delivery?.submittedAt)) {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        if (request.status === 'QUEUED' && !delivery) {
          const cancelled = await tx.messageRequest.updateMany({
            where: { id, salonId: request.salonId, status: 'QUEUED' },
            data: { status: 'CANCELLED', updatedAt: now },
          });
          if (cancelled.count === 0) {
            throw new ConflictError('Message is not in a state that allows this action');
          }
        } else if (
          request.status === 'DISPATCHED' &&
          delivery?.mode === 'MANUAL' &&
          delivery.status === 'PENDING'
        ) {
          const cancelled = await tx.messageRequest.updateMany({
            where: { id, salonId: request.salonId, status: 'DISPATCHED' },
            data: { status: 'CANCELLED', updatedAt: now },
          });
          if (cancelled.count === 0) {
            throw new ConflictError('Message is not in a state that allows this action');
          }
        } else {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: request.salonId,
            actorId: admin.adminId,
            action: 'MESSAGE_REQUEST_CANCELLED',
            resource: 'message_request',
            resourceId: request.id,
            result: 'SUCCESS',
            metadata: {
              previousStatus: request.status,
              vipRequestId: request.vipRequestId,
            },
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }

    const row = await this.messages.findById(id);
    if (!row) {
      throw new NotFoundError('Message not found');
    }
    return toAdminMessageItem(row as AdminMessageRow, this.config.values);
  }
}

@Injectable()
export class RetryBaleMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: AdminMessageRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(admin: PlatformAdminPrincipal, id: string) {
    const queued = await this.messages.findById(id);
    if (!queued) {
      throw new NotFoundError('Message not found');
    }
    if (queued.vipRequestId) {
      throw new ConflictError(VIP_BALE_NOT_AVAILABLE_MESSAGE);
    }
    if (!getBaleSafirSettings(this.config.values)) {
      return toAdminMessageItem(queued as AdminMessageRow, this.config.values);
    }

    const now = new Date();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const request = await tx.messageRequest.findFirst({ where: { id } });
        if (!request) {
          throw new NotFoundError('Message not found');
        }
        if (request.vipRequestId) {
          throw new ConflictError(VIP_BALE_NOT_AVAILABLE_MESSAGE);
        }
        if (!request.recipientPhoneNumber) {
          throw new ConflictError('Message destination cannot be verified');
        }
        const delivery = await tx.messageDelivery.findFirst({
          where: { messageRequestId: id, salonId: request.salonId },
        });
        if (!delivery || delivery.mode !== 'BALE') {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        if (delivery.status === 'SENT' || delivery.status === 'PROCESSING') {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        const nextGeneration = delivery.executionGeneration + 1;
        const activeKey = `message-delivery:${delivery.id}:${delivery.executionGeneration}`;
        const alreadyActivated = await tx.outboxEvent.findUnique({ where: { dedupeKey: activeKey } });
        if (delivery.status === 'PENDING' && alreadyActivated) {
          throw new ConflictError('Message execution is already active');
        }
        if (!['PENDING', 'FAILED'].includes(delivery.status)) {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        const requestClaim = await tx.messageRequest.updateMany({
          where: { id, salonId: request.salonId, status: { in: ['DISPATCHED', 'FAILED'] } },
          data: { status: 'DISPATCHED', updatedAt: now },
        });
        if (requestClaim.count === 0) {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        const deliveryClaim = await tx.messageDelivery.updateMany({
          where: {
            id: delivery.id,
            salonId: delivery.salonId,
            status: { in: ['PENDING', 'FAILED'] },
            executionGeneration: delivery.executionGeneration,
          },
          data: {
            status: 'PENDING',
            executionGeneration: nextGeneration,
            executionToken: null,
            executionLockedUntil: null,
            failureCode: null,
            failedAt: null,
            submittedAt: null,
            updatedAt: now,
          },
        });
        if (deliveryClaim.count === 0) {
          throw new ConflictError('Message is not in a state that allows this action');
        }
        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: request.salonId,
            eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated,
            dedupeKey: `message-delivery:${delivery.id}:${nextGeneration}`,
            payload: {
              messageDeliveryId: delivery.id,
              messageRequestId: request.id,
              salonId: request.salonId,
              executionGeneration: nextGeneration,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: request.salonId,
            actorId: admin.adminId,
            action: 'MESSAGE_DELIVERY_RETRY_REQUESTED',
            resource: 'message_delivery',
            resourceId: delivery.id,
            result: 'SUCCESS',
            metadata: { messageRequestId: id, mode: 'BALE' },
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }

    const row = await this.messages.findById(id);
    if (!row) {
      throw new NotFoundError('Message not found');
    }
    return toAdminMessageItem(row as AdminMessageRow, this.config.values);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
