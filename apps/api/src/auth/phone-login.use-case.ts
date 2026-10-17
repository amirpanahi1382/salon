import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UnauthenticatedError, ValidationError, createId } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { signSalonSession } from './salon-session';
import { normalizeIranianMobile } from './signup-phone';

const PHONE_LOGIN_FAILURE = 'Invalid phone or password';

@Injectable()
export class PhoneLoginUseCase implements OnModuleInit {
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

  async execute(input: { phone: string; password: string }) {
    const phone = normalizeIranianMobile(input.phone);
    if (!phone) {
      throw new ValidationError('Enter an Iranian mobile number.');
    }
    const [user, admin] = await Promise.all([
      this.prisma.client.user.findUnique({
        where: { phone },
        select: {
          id: true,
          salonId: true,
          name: true,
          role: true,
          status: true,
          passwordHash: true,
          salon: { select: { status: true, accessState: true } },
        },
      }),
      this.prisma.client.platformAdmin.findUnique({
        where: { phone },
        select: { id: true, name: true, status: true, passwordHash: true },
      }),
    ]);

    const salonMatch =
      user !== null && user.status === 'ACTIVE' && user.salon.status === 'ACTIVE';
    const adminMatch = admin !== null && admin.status === 'ACTIVE';
    const matchedHash =
      salonMatch && !adminMatch
        ? user.passwordHash
        : adminMatch && !salonMatch
          ? admin.passwordHash
          : await this.timingHash();
    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(matchedHash, input.password);
    } catch {
      passwordValid = false;
    }
    if (!passwordValid || (salonMatch && adminMatch) || (!salonMatch && !adminMatch)) {
      throw new UnauthenticatedError(PHONE_LOGIN_FAILURE);
    }

    if (adminMatch && admin) {
      const accessToken = await this.jwt.signAsync({ sub: admin.id, scp: 'platform' });
      return {
        accountKind: 'PLATFORM_ADMIN' as const,
        accessToken,
        admin: { id: admin.id, name: admin.name },
      };
    }

    if (!user) {
      throw new UnauthenticatedError(PHONE_LOGIN_FAILURE);
    }
    const session = await signSalonSession(this.jwt, {
      id: user.id,
      salonId: user.salonId,
      role: user.role,
      accessState: user.salon.accessState,
    });

    if (session.sessionScope === 'onboarding') {
      await this.prisma.client.auditLog.create({
        data: {
          id: createId(),
          tenantId: user.salonId,
          actorId: user.id,
          action: 'SALON_SESSION_ISSUED',
          resource: 'user',
          resourceId: user.id,
          result: 'SUCCESS',
          metadata: {
            sessionScope: session.sessionScope,
            accessState: user.salon.accessState,
            method: 'phone',
            sessionId: session.sessionId,
          },
        },
      });
    }

    return {
      accountKind: 'SALON_USER' as const,
      accessToken: session.accessToken,
      sessionScope: session.sessionScope,
      accessState: user.salon.accessState,
      user: {
        id: user.id,
        tenantId: user.salonId,
        name: user.name,
        email: null,
        role: user.role,
      },
    };
  }
}
