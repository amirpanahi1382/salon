import { Injectable } from '@nestjs/common';
import { getBaleSafirSettings } from '@salon/config';
import { Prisma } from '@salon/database';
import {
  createId,
  DOMAIN_EVENT_TYPES,
  InfrastructureError,
  NotFoundError,
  normalizeMessageBody,
  ValidationError,
  type AuthenticatedPrincipal,
  type OpportunityType,
} from '@salon/shared';
import { ActionRepository } from '../action/action.repository';
import { ACTION_SELECT, type ActionRow } from '../action/action.mapper';
import { CurrentOpportunityService } from '../action/current-opportunity.service';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { MESSAGE_SEND_OPERATION, messageSendRequestHash } from './message-idempotency';
import { toMessageResponse, type MessageRow } from './message.mapper';
import { MessageRepository } from './message.repository';

@Injectable()
export class SendOpportunityMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageRepository,
    private readonly actions: ActionRepository,
    private readonly opportunities: CurrentOpportunityService,
    private readonly config: AppConfigService,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    opportunityType: OpportunityType,
    text: string,
    idempotencyKey: string,
  ) {
    if (!getBaleSafirSettings(this.config.values)) {
      throw new InfrastructureError('Bale messaging is not configured');
    }
    const body = normalizeMessageBody(text);
    if (!body) {
      throw new ValidationError('Message text is invalid');
    }

    const requestHash = messageSendRequestHash(customerId, opportunityType, body);
    const deliveryId = createId();
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
          resourceType: 'message_delivery',
          resourceId: deliveryId,
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
          const replay = await this.messages.findById(principal.tenantId, existing.resourceId, tx);
          if (!replay) {
            throw new NotFoundError('Message not found');
          }
          return replay as MessageRow;
        }

        const action = await this.ensureOpenAction(
          tx,
          principal,
          customerId,
          opportunityType,
          now,
        );

        const row = await tx.messageDelivery.create({
          data: {
            id: deliveryId,
            salonId: principal.tenantId,
            customerId,
            actionId: action.id,
            provider: 'BALE_SAFIR',
            channel: 'TEXT',
            status: 'PENDING',
            body,
            providerRequestId: deliveryId,
            createdBy: principal.userId,
            updatedAt: now,
          },
          select: {
            id: true,
            customerId: true,
            actionId: true,
            provider: true,
            channel: true,
            status: true,
            body: true,
            failureCode: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
            submittedAt: true,
            failedAt: true,
            action: { select: { opportunityType: true } },
            customer: { select: { phoneNumber: true } },
          },
        });

        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.MessageSendRequested,
            payload: {
              messageDeliveryId: deliveryId,
              salonId: principal.tenantId,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'MESSAGE_SEND_REQUESTED',
            resource: 'message_delivery',
            resourceId: deliveryId,
            result: 'SUCCESS',
            metadata: {
              customerId,
              actionId: action.id,
              opportunityType,
              provider: 'BALE_SAFIR',
              status: 'PENDING',
            },
          },
        });
        return row as MessageRow;
      });

      return toMessageResponse(created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Customer not found');
      }
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

    const actionId = createId();
    try {
      const row = await tx.opportunityAction.create({
        data: {
          id: actionId,
          salonId: principal.tenantId,
          customerId,
          opportunityType,
          status: 'OPEN',
          createdBy: principal.userId,
          updatedAt: now,
        },
        select: ACTION_SELECT,
      });
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
      return row as ActionRow;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingOpen = await this.actions.findOpen(
          principal.tenantId,
          customerId,
          opportunityType,
          tx,
        );
        if (existingOpen) {
          return existingOpen as ActionRow;
        }
      }
      throw error;
    }
  }
}
