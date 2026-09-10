import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  createId,
  DOMAIN_EVENT_TYPES,
  MessageDailyLimitError,
  NotFoundError,
  messageBusinessDateValue,
  normalizeMessageBody,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { throwIfDailyLimit } from './message-daily-limit';
import {
  MANUAL_OUTREACH_MESSAGE_SEND_OPERATION,
  manualOutreachMessageRequestHash,
} from './message-idempotency';
import { toMessageResponse, type MessageRequestRow } from './message.mapper';
import { MessageRepository } from './message.repository';

@Injectable()
export class SendManualOutreachMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    text: string,
    idempotencyKey: string,
  ) {
    const body = normalizeMessageBody(text);
    if (!body) {
      throw new ValidationError('Message text is invalid');
    }

    const requestHash = manualOutreachMessageRequestHash(customerId, body);
    const requestId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: MANUAL_OUTREACH_MESSAGE_SEND_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'message_request',
          resourceId: requestId,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: MANUAL_OUTREACH_MESSAGE_SEND_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Message not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          const replay = await this.messages.findRequestById(
            principal.tenantId,
            existing.resourceId,
            tx,
          );
          if (!replay) {
            throw new NotFoundError('Message not found');
          }
          return replay as MessageRequestRow;
        }

        const customer = await this.customers.findById(principal.tenantId, customerId, tx);
        if (!customer) {
          throw new NotFoundError('Customer not found');
        }

        const inserted = await this.messages.insertEnforceableIfAbsent(tx, {
          id: requestId,
          salonId: principal.tenantId,
          customerId,
          actionId: null,
          createdByUserId: principal.userId,
          opportunityType: null,
          messageText: body,
          requestedAt: now,
          messageBusinessDate: messageBusinessDateValue(now),
        });
        if (!inserted) {
          throw new MessageDailyLimitError();
        }

        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.MessageRequested,
            payload: {
              messageRequestId: requestId,
              salonId: principal.tenantId,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'MESSAGE_REQUESTED',
            resource: 'message_request',
            resourceId: requestId,
            result: 'SUCCESS',
            metadata: {
              customerId,
              status: 'QUEUED',
              source: 'MANUAL_OUTREACH',
            },
          },
        });
        const row = await this.messages.findRequestById(principal.tenantId, requestId, tx);
        if (!row) {
          throw new NotFoundError('Message not found');
        }
        return row as MessageRequestRow;
      });

      return toMessageResponse(created);
    } catch (error: unknown) {
      if (error instanceof MessageDailyLimitError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Customer not found');
      }
      throwIfDailyLimit(error);
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}
