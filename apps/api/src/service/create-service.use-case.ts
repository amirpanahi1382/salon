import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import type { CreateServiceDto } from './service.dto';
import { toServiceResponse } from './service.mapper';

@Injectable()
export class CreateServiceUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateServiceDto) {
    const name = input.name.trim();
    const id = createId();
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const service = await tx.service.create({
          data: {
            id,
            salonId: principal.tenantId,
            name,
            status: 'ACTIVE',
            updatedAt: new Date(),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.ServiceCreated,
            payload: { serviceId: id, salonId: principal.tenantId },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'SERVICE_CREATED',
            resource: 'service',
            resourceId: id,
            result: 'SUCCESS',
            metadata: { salonId: principal.tenantId },
          },
        });
        return service;
      });
      return toServiceResponse(created);
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
