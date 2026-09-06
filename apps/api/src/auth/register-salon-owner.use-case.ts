import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
} from '@salon/shared';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { RegisterSalonOwnerDto } from './auth.dto';

@Injectable()
export class RegisterSalonOwnerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async execute(input: RegisterSalonOwnerDto) {
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
    const salonId = createId();
    const userId = createId();
    const now = new Date();

    try {
      await this.prisma.client.$transaction(async (tx) => {
      await tx.salon.create({
        data: {
          id: salonId,
          name: input.salonName.trim(),
          status: 'ACTIVE',
          updatedAt: now,
        },
      });

      await tx.user.create({
        data: {
          id: userId,
          salonId,
          name: input.ownerName.trim(),
          email,
          passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
          updatedAt: now,
        },
      });

      await tx.outboxEvent.createMany({
        data: [
          {
            id: createId(),
            tenantId: salonId,
            eventType: DOMAIN_EVENT_TYPES.SalonCreated,
            payload: { salonId },
          },
          {
            id: createId(),
            tenantId: salonId,
            eventType: DOMAIN_EVENT_TYPES.UserCreated,
            payload: { userId, salonId, role: 'OWNER' },
          },
        ],
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: salonId,
          actorId: userId,
          action: 'USER_REGISTERED',
          resource: 'user',
          resourceId: userId,
          result: 'SUCCESS',
          metadata: { role: 'OWNER' },
        },
      });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('An account with this email already exists');
      }
      throw error;
    }

    const accessToken = await this.jwt.signAsync({
      sub: userId,
      tid: salonId,
      role: 'OWNER',
    });

    return {
      accessToken,
      user: {
        id: userId,
        tenantId: salonId,
        name: input.ownerName.trim(),
        email,
        role: 'OWNER' as const,
      },
    };
  }
}
