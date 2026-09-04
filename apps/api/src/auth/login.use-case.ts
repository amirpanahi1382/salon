import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UnauthenticatedError } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { LoginDto } from './auth.dto';

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async execute(input: LoginDto) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.client.user.findUnique({
      where: { email },
      select: {
        id: true,
        salonId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        salon: { select: { status: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE' || user.salon.status !== 'ACTIVE') {
      throw new UnauthenticatedError('Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthenticatedError('Invalid email or password');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      tid: user.salonId,
      role: user.role,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        tenantId: user.salonId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
