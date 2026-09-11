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
  type OpportunityType,
} from '@salon/shared';
import { ActionRepository } from '../action/action.repository';
import { findLastVisitId } from '../action/opportunity-suppression';
import { type ActionRow } from '../action/action.mapper';
import { CurrentOpportunityService } from '../action/current-opportunity.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { throwIfDailyLimit } from './message-daily-limit';
import { MESSAGE_SEND_OPERATION, messageSendRequestHash } from './message-idempotency';
import { toMessageResponse, type MessageRequestRow } from './message.mapper';
import { MessageRepository } from './message.repository';

@Injectable()
export class SendOpportunityMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageRepository,
    private readonly actions: ActionRepository,
    private readonly opportunities: CurrentOpportunityService,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    opportunityType: OpportunityType,
    text: string,
    idempotencyKey: string,
  ) {
    const body = normalizeMessageBody(text);
    if (!body) {
      throw new ValidationError('Message text is invalid');
    }

    const requestHash = messageSendRequestHash(customerId, opportunityType, body);
    const requestId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: MESSAGE_SEND_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'message_request',
          resourceId: requestId,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: MESSAGE_SEND_OPERATION,
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

        const action = await this.ensureOpenAction(
          tx,
          principal,
          customerId,
          opportunityType,
          now,
        );

        const inserted = await this.messages.insertEnforceableIfAbsent(tx, {
          id: requestId,
          salonId: principal.tenantId,
          customerId,
          actionId: action.id,
          createdByUserId: principal.userId,
          opportunityType,
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
              actionId: action.id,
              opportunityType,
              status: 'QUEUED',
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

  private async ensureOpenAction(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    customerId: string,
    opportunityType: OpportunityType,
    now: Date,
  ): Promise<ActionRow> {
    const open = await this.actions.findOpen(principal.tenantId, customerId, opportunityType, tx);
    if (open) {
      return open as ActionRow;
    }

    const presence = await this.opportunities.hasOpportunity(
      principal.tenantId,
      customerId,
      opportunityType,
    );
    if (presence === 'missing-customer') {
      throw new NotFoundError('Customer not found');
    }
    if (presence === 'missing-opportunity') {
      throw new NotFoundError('Opportunity not found');
    }

    const sourceVisitId = await findLastVisitId(tx, principal.tenantId, customerId);
    const actionId = createId();
    const inserted = await this.actions.insertOpenIfAbsent(tx, {
      id: actionId,
      salonId: principal.tenantId,
      customerId,
      opportunityType,
      createdBy: principal.userId,
      now,
      sourceVisitId,
    });
    if (inserted) {
      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          eventType: DOMAIN_EVENT_TYPES.ActionCreated,
          payload: {
            actionId,
            customerId,
            salonId: principal.tenantId,
            opportunityType,
            status: 'OPEN',
          },
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'ACTION_CREATED',
          resource: 'opportunity_action',
          resourceId: actionId,
          result: 'SUCCESS',
          metadata: { customerId, opportunityType, status: 'OPEN' },
        },
      });
      const created = await this.actions.findById(principal.tenantId, actionId, tx);
      if (!created) {
        throw new NotFoundError('Action not found');
      }
      return created as ActionRow;
    }

    const existingOpen = await this.actions.findOpen(
      principal.tenantId,
      customerId,
      opportunityType,
      tx,
    );
    if (existingOpen) {
      return existingOpen as ActionRow;
    }
    throw new NotFoundError('Opportunity not found');
  }
}
