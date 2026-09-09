import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ActionRepository } from './action.repository';
import { toActionResponse, type ActionRow } from './action.mapper';
import type { ActionStatus } from './action.dto';

@Injectable()
export class CompleteActionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: ActionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, id: string) {
    return transitionAction(this.prisma, this.actions, principal, id, 'COMPLETED');
  }
}

@Injectable()
export class DismissActionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: ActionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, id: string) {
    return transitionAction(this.prisma, this.actions, principal, id, 'DISMISSED');
  }
}

async function transitionAction(
  prisma: PrismaService,
  actions: ActionRepository,
  principal: AuthenticatedPrincipal,
  id: string,
  target: 'COMPLETED' | 'DISMISSED',
) {
  const existing = await actions.findById(principal.tenantId, id);
  if (!existing) {
    throw new NotFoundError('Action not found');
  }

  const updated = await prisma.client.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: ActionStatus }>>(Prisma.sql`
      SELECT status
      FROM opportunity_actions
      WHERE id = ${id}::uuid AND salon_id = ${principal.tenantId}::uuid
      FOR UPDATE
    `);
    if (locked.length === 0) {
      throw new NotFoundError('Action not found');
    }
    const current = locked[0]!.status;
    if (current === target) {
      const replay = await actions.findById(principal.tenantId, id, tx);
      if (!replay) {
        throw new NotFoundError('Action not found');
      }
      return replay as ActionRow;
    }
    if (current !== 'OPEN') {
      throw new ConflictError(
        target === 'COMPLETED' ? 'Action was already dismissed' : 'Action was already completed',
      );
    }

    const now = new Date();
    await tx.opportunityAction.updateMany({
      where: { id, salonId: principal.tenantId, status: 'OPEN' },
      data:
        target === 'COMPLETED'
          ? { status: 'COMPLETED', completedAt: now, updatedAt: now }
          : { status: 'DISMISSED', dismissedAt: now, updatedAt: now },
    });

    const row = await actions.findById(principal.tenantId, id, tx);
    if (!row) {
      throw new NotFoundError('Action not found');
    }

    await tx.outboxEvent.create({
      data: {
        id: createId(),
        tenantId: principal.tenantId,
        eventType:
          target === 'COMPLETED'
            ? DOMAIN_EVENT_TYPES.ActionCompleted
            : DOMAIN_EVENT_TYPES.ActionDismissed,
        payload: {
          actionId: id,
          customerId: row.customerId,
          salonId: principal.tenantId,
          opportunityType: row.opportunityType,
          status: target,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: target === 'COMPLETED' ? 'ACTION_COMPLETED' : 'ACTION_DISMISSED',
        resource: 'opportunity_action',
        resourceId: id,
        result: 'SUCCESS',
        metadata: {
          customerId: row.customerId,
          opportunityType: row.opportunityType,
          from: 'OPEN',
          to: target,
        },
      },
    });
    return row as ActionRow;
  });

  return toActionResponse(updated);
}
