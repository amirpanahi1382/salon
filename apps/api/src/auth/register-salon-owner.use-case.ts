import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma } from '@salon/database';
import { ConflictError, createId } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { RegisterSalonOwnerDto } from './auth.dto';
import { provisionSalonOwner } from './provision-salon-owner';
import { signSalonSession } from './salon-session';

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
    const ownerName = input.ownerName.trim();

    try {
      await this.prisma.client.$transaction(async (tx) => {
        await provisionSalonOwner(tx, {
          salonId,
          userId,
          salonName: input.salonName.trim(),
          ownerName,
          passwordHash,
          email,
          phone: null,
          accessState: 'PRODUCT',
          additionalUsersAllowed: true,
          now,
        });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('An account with this email already exists');
      }
      throw error;
    }

    const session = await signSalonSession(this.jwt, {
      id: userId,
      salonId,
      role: 'OWNER',
      accessState: 'PRODUCT',
    });

    return {
      accessToken: session.accessToken,
      sessionScope: session.sessionScope,
      accessState: 'PRODUCT' as const,
      user: {
        id: userId,
        tenantId: salonId,
        name: ownerName,
        email,
        role: 'OWNER' as const,
      },
    };
  }
}
