import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UnauthenticatedError, createId } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { LoginDto } from './auth.dto';

@Injectable()
export class PlatformAdminLoginUseCase implements OnModuleInit {
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.timingHash();
    await this.bootstrapFromEnv();
  }

  private async timingHash(): Promise<string> {
    if (!this.dummyPasswordHash) {
      this.dummyPasswordHash = await argon2.hash('phase-a-login-timing-dummy', {
        type: argon2.argon2id,
      });
    }
    return this.dummyPasswordHash;
  }

  private async bootstrapFromEnv(): Promise<void> {
    const email = this.config.values.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    const password = this.config.values.PLATFORM_ADMIN_PASSWORD;
    if (!email || !password) {
      return;
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const existing = await this.prisma.client.platformAdmin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.client.platformAdmin.update({
        where: { id: existing.id },
        data: { passwordHash, status: 'ACTIVE', updatedAt: new Date() },
      });
      return;
    }
    await this.prisma.client.platformAdmin.create({
      data: {
        id: createId(),
        email,
        passwordHash,
        name: 'Platform Admin',
        updatedAt: new Date(),
      },
    });
  }

  async execute(input: LoginDto) {
    const email = input.email.trim().toLowerCase();
    const admin = await this.prisma.client.platformAdmin.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        passwordHash: true,
      },
    });

    const hash = admin?.passwordHash ?? (await this.timingHash());
    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(hash, input.password);
    } catch {
      passwordValid = false;
    }

    if (!admin || !passwordValid || admin.status !== 'ACTIVE') {
      throw new UnauthenticatedError('Invalid email or password');
    }

    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      scp: 'platform',
    });

    return {
      accessToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
    };
  }
}
