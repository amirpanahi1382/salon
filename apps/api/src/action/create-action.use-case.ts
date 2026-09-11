import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
  type OpportunityType,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { ACTION_CREATE_OPERATION, actionCreateRequestHash } from './action-idempotency';
import { ActionRepository } from './action.repository';
import { toActionResponse, type ActionRow } from './action.mapper';
import { CurrentOpportunityService } from './current-opportunity.service';
import { findLastVisitId } from './opportunity-suppression';

@Injectable()
export class CreateActionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: ActionRepository,
    private readonly opportunities: CurrentOpportunityService,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    customerId: string,
    opportunityType: OpportunityType,
    idempotencyKey: string,
  ) {
    const requestHash = actionCreateRequestHash(customerId, opportunityType);
    const actionId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: ACTION_CREATE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'opportunity_action',
          resourceId: actionId,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: ACTION_CREATE_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Action not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          const replay = await this.actions.findById(principal.tenantId, existing.resourceId, tx);
          if (!replay) {
            throw new NotFoundError('Action not found');
          }
          return replay as ActionRow;
        }

        const open = await this.actions.findOpen(
          principal.tenantId,
          customerId,
          opportunityType,
          tx,
        );
        if (open) {
          await bindIdempotencyResource(tx, principal, idempotencyKey, open.id);
          return open as ActionRow;
        }

        const sourceVisitId = await findLastVisitId(tx, principal.tenantId, customerId);
        const sameEpisode = await this.actions.findBySourceVisit(
          principal.tenantId,
          customerId,
          opportunityType,
          sourceVisitId,
          tx,
        );
        if (sameEpisode) {
          await bindIdempotencyResource(tx, principal, idempotencyKey, sameEpisode.id);
          return sameEpisode as ActionRow;
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
          const row = await this.actions.findById(principal.tenantId, actionId, tx);
          if (!row) {
            throw new NotFoundError('Action not found');
          }
          return row as ActionRow;
        }

        const conflictOpen = await this.actions.findOpen(
          principal.tenantId,
          customerId,
          opportunityType,
          tx,
        );
        if (conflictOpen) {
          await bindIdempotencyResource(tx, principal, idempotencyKey, conflictOpen.id);
          return conflictOpen as ActionRow;
        }
        const conflictEpisode = await this.actions.findBySourceVisit(
          principal.tenantId,
          customerId,
          opportunityType,
          sourceVisitId,
          tx,
        );
        if (conflictEpisode) {
          await bindIdempotencyResource(tx, principal, idempotencyKey, conflictEpisode.id);
          return conflictEpisode as ActionRow;
        }
        throw new ConflictError('A conflicting record already exists');
      });

      return toActionResponse(created);
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
}

async function bindIdempotencyResource(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedPrincipal,
  idempotencyKey: string,
  resourceId: string,
) {
  await tx.idempotencyRecord.update({
    where: {
      tenantId_actorId_operation_key: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        operation: ACTION_CREATE_OPERATION,
        key: idempotencyKey,
      },
    },
    data: { resourceId },
  });
}
