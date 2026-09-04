import { Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  canChangeUserStatus,
  createId,
  DOMAIN_EVENT_TYPES,
  ForbiddenError,
  NotFoundError,
  wouldLeaveSalonWithoutOwner,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { lockSalonForUpdate } from './lock-salon';
import type { ChangeUserStatusDto } from './user.dto';
import { toSalonUserResponse } from './user.mapper';

@Injectable()
export class ChangeUserStatusUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    principal: AuthenticatedPrincipal,
    userId: string,
    input: ChangeUserStatusDto,
  ) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await lockSalonForUpdate(tx, principal.tenantId);

      const target = await tx.user.findFirst({
        where: { id: userId, salonId: principal.tenantId },
        select: { id: true, role: true, status: true },
      });
      if (!target) {
        throw new NotFoundError('User not found');
      }

      if (!canChangeUserStatus(principal.role, target.role)) {
        throw new ForbiddenError();
      }

      const activeOwnerCount = await tx.user.count({
        where: {
          salonId: principal.tenantId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      if (
        wouldLeaveSalonWithoutOwner({
          activeOwnerCount,
          targetIsCurrentlyActiveOwner: target.role === 'OWNER' && target.status === 'ACTIVE',
          nextRole: target.role,
          nextStatus: input.status,
        })
      ) {
        throw new BusinessRuleError('A salon must keep at least one active OWNER');
      }

      const user = await tx.user.update({
        where: { id: target.id },
        data: { status: input.status, updatedAt: new Date() },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          eventType: DOMAIN_EVENT_TYPES.UserStatusChanged,
          payload: {
            userId: target.id,
            salonId: principal.tenantId,
            from: target.status,
            to: input.status,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'USER_STATUS_CHANGED',
          resource: 'user',
          resourceId: target.id,
          result: 'SUCCESS',
          metadata: { from: target.status, to: input.status },
        },
      });

      return user;
    });

    return toSalonUserResponse(updated);
  }
}
