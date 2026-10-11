import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UnauthenticatedError } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { LoginDto } from './auth.dto';

@Injectable()
export class PlatformAdminLoginUseCase implements OnModuleInit {
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Timing hash only. Do not upsert platform admins here: module init runs before
    // the HTTP port binds, so a failed listen would already have rotated a credential.
    // Development upsert is the explicit command `pnpm db:bootstrap-admin`.
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
