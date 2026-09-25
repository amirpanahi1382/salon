import { Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  createId,
  DOMAIN_EVENT_TYPES,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { UpdateSalonProfileDto } from './salon.dto';
import { toSalonProfileResponse } from './salon.mapper';

@Injectable()
export class UpdateSalonProfileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal, input: UpdateSalonProfileDto) {
    if (principal.role !== 'OWNER') {
      throw new ForbiddenError();
    }

    if (input.name === undefined && input.phone === undefined && input.address === undefined) {
      throw new BusinessRuleError('No salon profile fields to update');
    }

    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && (!name || name.length > 120)) {
      throw new ValidationError('name must be 1 to 120 characters');
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const salon = await tx.salon.findFirst({
        where: { id: principal.tenantId },
        select: { id: true },
      });
      if (!salon) {
        throw new NotFoundError('Salon not found');
      }

      const next = await tx.salon.update({
        where: { id: principal.tenantId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(input.phone !== undefined ? { phone: normalizeOptionalText(input.phone) } : {}),
          ...(input.address !== undefined ? { address: normalizeOptionalText(input.address) } : {}),
          updatedAt: new Date(),
        },
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          eventType: DOMAIN_EVENT_TYPES.SalonUpdated,
          payload: { salonId: principal.tenantId },
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'SALON_UPDATED',
          resource: 'salon',
          resourceId: principal.tenantId,
          result: 'SUCCESS',
          metadata: {
            fields: Object.keys(input).filter((key) => input[key as keyof UpdateSalonProfileDto] !== undefined),
          },
        },
      });

      return next;
    });

    return toSalonProfileResponse(updated);
  }
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
