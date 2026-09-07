import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { normalizeServiceName } from './service-name';
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
    const name = input.name === undefined ? undefined : normalizeServiceName(input.name);
    if (name === undefined && !input.status) {
      throw new ValidationError('No updates provided');
    }
    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const service = await tx.service.update({
          where: { id_salonId: { id, salonId: principal.tenantId } },
          data: {
            ...(name !== undefined ? { name } : {}),
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
        const audits: Array<{ action: string; metadata: Record<string, string> }> = [];
        if (name !== undefined && name !== existing.name) {
          audits.push({
            action: 'SERVICE_UPDATED',
            metadata: { salonId: principal.tenantId },
          });
        }
        if (input.status && input.status !== existing.status) {
          audits.push({
            action: input.status === 'INACTIVE' ? 'SERVICE_DEACTIVATED' : 'SERVICE_ACTIVATED',
            metadata: { salonId: principal.tenantId, status: input.status },
          });
        }
        if (audits.length === 0) {
          audits.push({
            action: 'SERVICE_UPDATED',
            metadata: { salonId: principal.tenantId },
          });
        }
        for (const audit of audits) {
          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              actorId: principal.userId,
              action: audit.action,
              resource: 'service',
              resourceId: id,
              result: 'SUCCESS',
              metadata: audit.metadata,
            },
          });
        }
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
