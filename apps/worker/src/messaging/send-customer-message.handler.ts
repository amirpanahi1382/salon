import { Injectable } from '@nestjs/common';
import { createId, DOMAIN_EVENT_TYPES, type MessageFailureCode } from '@salon/shared';
import type { OutboxEvent } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { BaleSafirMessageSender } from './bale-safir.sender';
import { RetryableMessageSendError } from './message-sender';

@Injectable()
export class SendCustomerMessageHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: BaleSafirMessageSender,
  ) {}

  async handle(event: OutboxEvent, maxAttempts: number): Promise<void> {
    const deliveryId = payloadId(event.payload, 'messageDeliveryId');
    if (
      !deliveryId ||
      !event.tenantId ||
      event.eventType !== DOMAIN_EVENT_TYPES.MessageSendRequested
    ) {
      throw new Error('Invalid MessageSendRequested payload');
    }

    const delivery = await this.prisma.client.messageDelivery.findFirst({
      where: { id: deliveryId, salonId: event.tenantId },
      include: { customer: { select: { phoneNumber: true } } },
    });
    if (!delivery) {
      throw new Error('Message delivery not found');
    }
    if (delivery.status === 'SENT' || delivery.status === 'FAILED') {
      return;
    }

    await this.prisma.client.messageDelivery.updateMany({
      where: {
        id: delivery.id,
        salonId: delivery.salonId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: { status: 'PROCESSING', updatedAt: new Date() },
    });

    const result = await this.sender.sendText({
      requestId: delivery.providerRequestId,
      phoneNumber: delivery.customer.phoneNumber,
      text: delivery.body,
    });

    if (result.outcome === 'sent') {
      await this.markSent(delivery.id, delivery.salonId, result.providerMessageId, delivery.createdBy);
      return;
    }

    if (result.outcome === 'failed') {
      await this.markFailed(delivery.id, delivery.salonId, result.code, delivery.createdBy);
      return;
    }

    if (event.attemptCount >= maxAttempts) {
      await this.markFailed(delivery.id, delivery.salonId, result.code, delivery.createdBy);
      throw new RetryableMessageSendError(result.code, result.retryAfterMs);
    }
    throw new RetryableMessageSendError(result.code, result.retryAfterMs);
  }

  private async markSent(
    id: string,
    salonId: string,
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
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId,
          action: 'MESSAGE_SENT',
          resource: 'message_delivery',
          resourceId: id,
          result: 'SUCCESS',
          metadata: { provider: 'BALE_SAFIR', status: 'SENT' },
        },
      });
    });
  }

  private async markFailed(
    id: string,
    salonId: string,
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
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId,
          action: 'MESSAGE_FAILED',
          resource: 'message_delivery',
          resourceId: id,
          result: 'SUCCESS',
          metadata: { provider: 'BALE_SAFIR', status: 'FAILED', failureCode: code },
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
