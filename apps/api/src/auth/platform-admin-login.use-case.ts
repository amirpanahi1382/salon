import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { NotFoundError } from '@salon/shared';
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
    // The first admin is the explicit command `pnpm db:bootstrap-admin`.
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

  async execute(_input: LoginDto): Promise<never> {
    throw new NotFoundError();
  }
}
