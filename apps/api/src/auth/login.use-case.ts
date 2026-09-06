import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UnauthenticatedError } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { LoginDto } from './auth.dto';

@Injectable()
export class LoginUseCase implements OnModuleInit {
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.timingHash();
  }

  private async timingHash(): Promise<string> {
    if (!this.dummyPasswordHash) {
      this.dummyPasswordHash = await argon2.hash('phase-a-login-timing-dummy', {
        type: argon2.argon2id,
      });
    }
    return this.dummyPasswordHash;
  }

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

    const hash = user?.passwordHash ?? (await this.timingHash());
    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(hash, input.password);
    } catch {
      passwordValid = false;
    }

    if (
      !user ||
      !passwordValid ||
      user.status !== 'ACTIVE' ||
      user.salon.status !== 'ACTIVE'
    ) {
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
