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
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import type { UpdateServiceDto } from './service.dto';
import { toServiceResponse } from './service.mapper';
import { ServiceRepository } from './service.repository';

@Injectable()
export class UpdateServiceUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly services: ServiceRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, id: string, input: UpdateServiceDto) {
    const existing = await this.services.findById(principal.tenantId, id);
    if (!existing) {
      throw new NotFoundError('Service not found');
    }
    const name = input.name?.trim();
    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const service = await tx.service.update({
          where: { id_salonId: { id, salonId: principal.tenantId } },
          data: {
            ...(name ? { name } : {}),
            ...(input.status ? { status: input.status } : {}),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.ServiceUpdated,
            payload: { serviceId: id, salonId: principal.tenantId },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'SERVICE_UPDATED',
            resource: 'service',
            resourceId: id,
            result: 'SUCCESS',
            metadata: { salonId: principal.tenantId },
          },
        });
        return service;
      });
      return toServiceResponse(updated);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A service with this name already exists');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}
