import { Injectable } from '@nestjs/common';
import { Prisma, type OutboxEvent } from '@salon/database';
import { createId, DOMAIN_EVENT_TYPES, type MessageFailureCode } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { BaleSafirMessageSender } from './bale-safir.sender';
import { RetryableMessageSendError } from './message-sender';

type MessageDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class SendCustomerMessageHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: BaleSafirMessageSender,
  ) {}

  async handle(event: OutboxEvent, maxAttempts: number, signal?: AbortSignal): Promise<void> {
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
        customer: { select: { phoneNumber: true } },
        messageRequest: { select: { id: true, messageText: true } },
      },
    });
    if (!delivery) {
      throw new Error('Message delivery not found');
    }
    if (delivery.mode !== 'BALE') {
      return;
    }
    if (delivery.status === 'SENT' || delivery.status === 'FAILED') {
      return;
    }

    const claimed = await db.messageDelivery.updateMany({
      where: {
        id: delivery.id,
        salonId: delivery.salonId,
        mode: 'BALE',
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      return;
    }

    const result = await this.sender.sendText({
      requestId: delivery.providerRequestId,
      phoneNumber: delivery.customer.phoneNumber,
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
      );
      return;
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
      );
      return;
    }

    if (event.attemptCount >= maxAttempts) {
      await this.markFailed(
        delivery.id,
        delivery.salonId,
        delivery.messageRequest.id,
        result.code,
        delivery.createdBy,
      );
      throw new RetryableMessageSendError(result.code, result.retryAfterMs);
    }
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
    const delivery = await db.messageDelivery.findFirst({
      where: { id: deliveryId, salonId: event.tenantId },
      select: { id: true, messageRequestId: true, mode: true },
    });
    if (!delivery || delivery.mode !== 'BALE') {
      return;
    }

    await db.messageDelivery.updateMany({
      where: {
        id: delivery.id,
        salonId: event.tenantId,
        mode: 'BALE',
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: {
        status: 'FAILED',
        failureCode: code,
        failedAt: now,
        submittedAt: null,
        updatedAt: now,
      },
    });
    await db.messageRequest.updateMany({
      where: {
        id: delivery.messageRequestId,
        salonId: event.tenantId,
        status: { in: ['QUEUED', 'DISPATCHED'] },
      },
      data: { status: 'FAILED', updatedAt: now },
    });
  }

  private async markSent(
    id: string,
    salonId: string,
    messageRequestId: string,
    providerMessageId: string,
    actorId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.messageDelivery.updateMany({
        where: { id, salonId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'SENT',
          providerMessageId,
          submittedAt: now,
          failedAt: null,
          failureCode: null,
          updatedAt: now,
        },
      });
      await tx.messageRequest.updateMany({
        where: { id: messageRequestId, salonId, status: { in: ['QUEUED', 'DISPATCHED'] } },
        data: { status: 'SENT', updatedAt: now },
      });
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
  ): Promise<void> {
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.messageDelivery.updateMany({
        where: { id, salonId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'FAILED',
          failureCode: code,
          failedAt: now,
          submittedAt: null,
          updatedAt: now,
        },
      });
      await tx.messageRequest.updateMany({
        where: { id: messageRequestId, salonId, status: { in: ['QUEUED', 'DISPATCHED'] } },
        data: { status: 'FAILED', updatedAt: now },
      });
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

function payloadId(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
