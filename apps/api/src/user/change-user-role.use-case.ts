import { Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  createId,
  DOMAIN_EVENT_TYPES,
  ForbiddenError,
  NotFoundError,
  wouldLeaveSalonWithoutOwner,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { lockSalonForUpdate } from './lock-salon';
import type { ChangeUserRoleDto } from './user.dto';
import { toSalonUserResponse } from './user.mapper';

@Injectable()
export class ChangeUserRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    principal: AuthenticatedPrincipal,
    userId: string,
    input: ChangeUserRoleDto,
  ) {
    if (principal.role !== 'OWNER') {
      throw new ForbiddenError();
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      await lockSalonForUpdate(tx, principal.tenantId);

      const target = await tx.user.findFirst({
        where: { id: userId, salonId: principal.tenantId },
        select: { id: true, role: true, status: true },
      });
      if (!target) {
        throw new NotFoundError('User not found');
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
          nextRole: input.role,
          nextStatus: target.status,
        })
      ) {
        throw new BusinessRuleError('A salon must keep at least one active OWNER');
      }

      const user = await tx.user.update({
        where: { id: target.id },
        data: { role: input.role, updatedAt: new Date() },
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
          eventType: DOMAIN_EVENT_TYPES.UserRoleChanged,
          payload: {
            userId: target.id,
            salonId: principal.tenantId,
            from: target.role,
            to: input.role,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'USER_ROLE_CHANGED',
          resource: 'user',
          resourceId: target.id,
          result: 'SUCCESS',
          metadata: { from: target.role, to: input.role },
        },
      });

      return user;
    });

    return toSalonUserResponse(updated);
  }
}
