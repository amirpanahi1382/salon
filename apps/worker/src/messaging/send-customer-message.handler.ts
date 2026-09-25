import { Injectable } from '@nestjs/common';
import { Prisma, type OutboxEvent } from '@salon/database';
import { createId, DOMAIN_EVENT_TYPES, isUsableCustomerPhone, type MessageFailureCode } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { BaleSafirMessageSender } from './bale-safir.sender';
import { RetryableMessageSendError } from './message-sender';

type MessageDb = Prisma.TransactionClient | PrismaService['client'];

export type DeliveryExecutionResult = {
  outcome: 'completed' | 'terminal_failure' | 'obsolete' | 'stale';
};

@Injectable()
export class SendCustomerMessageHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: BaleSafirMessageSender,
  ) {}

  async handle(event: OutboxEvent, maxAttempts: number, signal?: AbortSignal): Promise<DeliveryExecutionResult> {
    try {
      return await this.execute(event, maxAttempts, signal);
    } catch (error: unknown) {
      if (error instanceof LostDeliveryExecutionError) return { outcome: 'stale' };
      throw error;
    }
  }

  private async execute(event: OutboxEvent, maxAttempts: number, signal?: AbortSignal): Promise<DeliveryExecutionResult> {
    const deliveryId = payloadId(event.payload, 'messageDeliveryId');
    if (
      !deliveryId ||
      !event.tenantId ||
      (event.eventType !== DOMAIN_EVENT_TYPES.MessageSendRequested &&
        event.eventType !== DOMAIN_EVENT_TYPES.MessageDeliveryActivated)
    ) {
      throw new Error('Invalid message delivery payload');
    }

    const db = this.prisma.client;
    const delivery = await db.messageDelivery.findFirst({
      where: { id: deliveryId, salonId: event.tenantId },
      include: {
        messageRequest: {
          select: {
            id: true,
            messageText: true,
            recipientPhoneNumber: true,
            vipRequestId: true,
            status: true,
          },
        },
      },
    });
    if (!delivery) {
      throw new Error('Message delivery not found');
    }
    if (delivery.mode !== 'BALE') {
      return { outcome: 'obsolete' };
    }
    if (delivery.status === 'SENT' || delivery.status === 'FAILED') {
      return { outcome: delivery.status === 'SENT' ? 'completed' : 'terminal_failure' };
    }
    if (delivery.messageRequest.status === 'CANCELLED') {
      return { outcome: 'obsolete' };
    }

    const requestedGeneration = payloadGeneration(event.payload);
    if (delivery.executionGeneration !== requestedGeneration) return { outcome: 'obsolete' };

    const executionToken = deliveryExecutionToken(event);
    const now = new Date();
    const lockedUntil = event.lockedUntil ?? new Date(now.getTime() + 30_000);

    const claimed = await db.messageDelivery.updateMany({
      where: {
        id: delivery.id,
        salonId: delivery.salonId,
        mode: 'BALE',
        executionGeneration: requestedGeneration,
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', executionLockedUntil: null },
          { status: 'PROCESSING', executionLockedUntil: { lt: now } },
        ],
        messageRequest: { status: { not: 'CANCELLED' } },
      },
      data: {
        status: 'PROCESSING',
        executionToken,
        executionLockedUntil: lockedUntil,
        attempts: { increment: 1 },
        updatedAt: now,
      },
    });
    if (claimed.count === 0) {
      throw new LostDeliveryExecutionError();
    }

    const outboxOwner = await db.outboxEvent.findFirst({
      where: {
        id: event.id,
        claimGeneration: event.claimGeneration,
        status: 'PROCESSING',
        lockedUntil: { gt: new Date() },
      },
      select: { id: true },
    });
    const owned = outboxOwner && await db.messageDelivery.findFirst({
      where: { id: delivery.id, salonId: delivery.salonId, status: 'PROCESSING', executionToken },
      select: { id: true },
    });
    if (!owned) throw new LostDeliveryExecutionError();

    if (delivery.messageRequest.vipRequestId) {
      await this.markFailed(
        delivery.id,
        delivery.salonId,
        delivery.messageRequest.id,
        'PROVIDER_INVALID_REQUEST',
        delivery.createdBy,
        executionToken,
        event,
      );
      return { outcome: 'terminal_failure' };
    }

    const phoneNumber = delivery.messageRequest.recipientPhoneNumber;
    if (!phoneNumber || !isUsableCustomerPhone(phoneNumber)) {
      await this.markFailed(
        delivery.id,
        delivery.salonId,
        delivery.messageRequest.id,
        'DESTINATION_UNVERIFIED',
        delivery.createdBy,
        executionToken,
        event,
      );
      return { outcome: 'terminal_failure' };
    }

    const result = await this.sender.sendText({
      requestId: delivery.providerRequestId,
      phoneNumber,
      text: delivery.messageRequest.messageText,
      signal,
    });

    if (result.outcome === 'sent') {
      await this.markSent(
        delivery.id,
        delivery.salonId,
        delivery.messageRequest.id,
        result.providerMessageId,
        delivery.createdBy,
        executionToken,
        event,
      );
      return { outcome: 'completed' };
    }

    if (signal?.aborted) {
      throw new RetryableMessageSendError('PROVIDER_UNKNOWN');
    }

    if (result.outcome === 'failed') {
      await this.markFailed(
        delivery.id,
        delivery.salonId,
        delivery.messageRequest.id,
        result.code,
        delivery.createdBy,
        executionToken,
        event,
      );
      return { outcome: 'terminal_failure' };
    }

    if (event.attemptCount >= maxAttempts) {
      await this.markFailed(
        delivery.id,
        delivery.salonId,
        delivery.messageRequest.id,
        result.code,
        delivery.createdBy,
        executionToken,
        event,
      );
      throw new RetryableMessageSendError(result.code, result.retryAfterMs);
    }
    const released = await db.messageDelivery.updateMany({
      where: { id: delivery.id, salonId: delivery.salonId, status: 'PROCESSING', executionToken },
      data: { status: 'PENDING', executionToken: null, executionLockedUntil: null, updatedAt: new Date() },
    });
    if (released.count === 0) throw new LostDeliveryExecutionError();
    throw new RetryableMessageSendError(result.code, result.retryAfterMs);
  }

  /**
   * Closes a Bale delivery that is still in-flight after the outbox event is dead-lettered.
   * SENT/FAILED (terminal) rows are left unchanged. Tenant scope is event.tenantId.
   */
  async abandonIfInFlight(
    event: OutboxEvent,
    code: MessageFailureCode,
    db: MessageDb = this.prisma.client,
  ): Promise<void> {
    const deliveryId = payloadId(event.payload, 'messageDeliveryId');
    if (!deliveryId || !event.tenantId) {
      return;
    }

    const now = new Date();
    const requestedGeneration = payloadGeneration(event.payload);
    const executionToken = deliveryExecutionToken(event);
    const delivery = await db.messageDelivery.findFirst({
      where: { id: deliveryId, salonId: event.tenantId },
      select: { id: true, messageRequestId: true, mode: true, status: true, executionGeneration: true },
    });
    if (!delivery || delivery.mode !== 'BALE' || delivery.executionGeneration !== requestedGeneration || delivery.status === 'SENT' || delivery.status === 'FAILED') {
      return;
    }

    const request = await db.messageRequest.updateMany({
      where: { id: delivery.messageRequestId, salonId: event.tenantId, status: { in: ['QUEUED', 'DISPATCHED'] } },
      data: { status: 'FAILED', updatedAt: now },
    });
    if (request.count === 0) return;
    // The outbox owner may fence a still-running matching delivery attempt at dead-letter time.
    const claimed = await db.messageDelivery.updateMany({
      where: {
        id: delivery.id,
        salonId: event.tenantId,
        mode: 'BALE',
        executionGeneration: requestedGeneration,
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', executionToken },
          { status: 'PROCESSING', executionLockedUntil: null },
          { status: 'PROCESSING', executionLockedUntil: { lt: now } },
        ],
      },
      data: { status: 'PROCESSING', executionToken, executionLockedUntil: now, updatedAt: now },
    });
    if (claimed.count === 0) throw new LostDeliveryExecutionError();
    const terminal = await db.messageDelivery.updateMany({
      where: {
        id: delivery.id,
        salonId: event.tenantId,
        mode: 'BALE',
        status: 'PROCESSING',
        executionToken,
      },
      data: {
        status: 'FAILED',
        failureCode: code,
        failedAt: now,
        submittedAt: null,
        executionToken: null,
        executionLockedUntil: null,
        updatedAt: now,
      },
    });
    if (terminal.count === 0) throw new LostDeliveryExecutionError();
    await db.outboxEvent.create({
      data: {
        id: createId(), tenantId: event.tenantId, eventType: DOMAIN_EVENT_TYPES.MessageFailed,
        payload: { messageDeliveryId: delivery.id, messageRequestId: delivery.messageRequestId, salonId: event.tenantId, mode: 'BALE', failureCode: code },
      },
    });
    await db.auditLog.create({
      data: {
        id: createId(), tenantId: event.tenantId, actorId: null, action: 'MESSAGE_FAILED',
        resource: 'message_delivery', resourceId: delivery.id, result: 'SUCCESS',
        metadata: { provider: 'BALE_SAFIR', status: 'FAILED', failureCode: code, mode: 'BALE' },
      },
    });
  }

  private async markSent(
    id: string,
    salonId: string,
    messageRequestId: string,
    providerMessageId: string,
    actorId: string,
    executionToken: string,
    event: OutboxEvent,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      if (!(await lockCurrentOutboxOwner(tx, event))) throw new LostDeliveryExecutionError();
      const request = await tx.messageRequest.updateMany({
        where: { id: messageRequestId, salonId, status: { in: ['QUEUED', 'DISPATCHED'] } },
        data: { status: 'SENT', updatedAt: now },
      });
      if (request.count === 0) throw new LostDeliveryExecutionError();
      const delivery = await tx.messageDelivery.updateMany({
        where: { id, salonId, status: 'PROCESSING', executionToken },
        data: {
          status: 'SENT',
          providerMessageId,
          submittedAt: now,
          failedAt: null,
          failureCode: null,
          executionToken: null,
          executionLockedUntil: null,
          updatedAt: now,
        },
      });
      if (delivery.count === 0) throw new LostDeliveryExecutionError();
      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: salonId,
          eventType: DOMAIN_EVENT_TYPES.MessageSent,
          payload: {
            messageDeliveryId: id,
            messageRequestId,
            salonId,
            mode: 'BALE',
          },
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId,
          action: 'MESSAGE_SENT',
          resource: 'message_delivery',
          resourceId: id,
          result: 'SUCCESS',
          metadata: { provider: 'BALE_SAFIR', status: 'SENT', mode: 'BALE' },
        },
      });
    });
  }

  private async markFailed(
    id: string,
    salonId: string,
    messageRequestId: string,
    code: MessageFailureCode,
    actorId: string,
    executionToken: string,
    event: OutboxEvent,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      if (!(await lockCurrentOutboxOwner(tx, event))) throw new LostDeliveryExecutionError();
      const request = await tx.messageRequest.updateMany({
        where: { id: messageRequestId, salonId, status: { in: ['QUEUED', 'DISPATCHED'] } },
        data: { status: 'FAILED', updatedAt: now },
      });
      if (request.count === 0) throw new LostDeliveryExecutionError();
      const delivery = await tx.messageDelivery.updateMany({
        where: { id, salonId, status: 'PROCESSING', executionToken },
        data: {
          status: 'FAILED',
          failureCode: code,
          failedAt: now,
          submittedAt: null,
          executionToken: null,
          executionLockedUntil: null,
          updatedAt: now,
        },
      });
      if (delivery.count === 0) throw new LostDeliveryExecutionError();
      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: salonId,
          eventType: DOMAIN_EVENT_TYPES.MessageFailed,
          payload: {
            messageDeliveryId: id,
            messageRequestId,
            salonId,
            mode: 'BALE',
            failureCode: code,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId,
          action: 'MESSAGE_FAILED',
          resource: 'message_delivery',
          resourceId: id,
          result: 'SUCCESS',
          metadata: { provider: 'BALE_SAFIR', status: 'FAILED', failureCode: code, mode: 'BALE' },
        },
      });
    });
  }
}

class LostDeliveryExecutionError extends Error {}

function payloadGeneration(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const value = (payload as Record<string, unknown>).executionGeneration;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function deliveryExecutionToken(event: OutboxEvent): string {
  return `${event.id}:${event.claimGeneration.toString()}`;
}

async function lockCurrentOutboxOwner(
  tx: Prisma.TransactionClient,
  event: OutboxEvent,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM outbox_events
    WHERE id = ${event.id}::uuid
      AND status = 'PROCESSING'::"OutboxStatus"
      AND claim_generation = ${event.claimGeneration}
      AND locked_until > clock_timestamp()
    FOR UPDATE
  `;
  return rows.length === 1;
}

function payloadId(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
