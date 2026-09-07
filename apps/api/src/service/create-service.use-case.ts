import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { ConflictError, type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { insertSalonService } from './insert-salon-service';
import type { CreateServiceDto } from './service.dto';
import { toServiceResponse } from './service.mapper';

@Injectable()
export class CreateServiceUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateServiceDto) {
    try {
      const created = await this.prisma.client.$transaction((tx) =>
        insertSalonService(tx, {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          name: input.name,
        }),
      );
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
