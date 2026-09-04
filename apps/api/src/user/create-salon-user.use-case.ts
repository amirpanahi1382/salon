import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@salon/database';
import {
  canAssignRole,
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  ForbiddenError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { CreateSalonUserDto } from './user.dto';
import { toSalonUserResponse } from './user.mapper';

@Injectable()
export class CreateSalonUserUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateSalonUserDto) {
    if (!canAssignRole(principal.role, input.role)) {
      throw new ForbiddenError();
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const userId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: userId,
            salonId: principal.tenantId,
            name: input.name.trim(),
            email,
            passwordHash,
            role: input.role,
            status: 'ACTIVE',
            updatedAt: now,
          },
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
            eventType: DOMAIN_EVENT_TYPES.UserCreated,
            payload: { userId, salonId: principal.tenantId, role: input.role },
          },
        });

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'USER_CREATED',
            resource: 'user',
            resourceId: userId,
            result: 'SUCCESS',
            metadata: { role: input.role },
          },
        });

        return user;
      });

      return toSalonUserResponse(created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('An account with this email already exists');
      }
      throw error;
    }
  }
}
