import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConflictError, ForbiddenError, createId, type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { signSalonSession } from './salon-session';

/**
 * Exchanges an onboarding session for a product session only after the salon
 * access state is already PRODUCT. The presented token is not rewritten.
 */
@Injectable()
export class ExchangeProductSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async execute(principal: AuthenticatedPrincipal) {
    if (principal.sessionScope !== 'onboarding') {
      throw new ConflictError('This session is already a product session');
    }
    const user = await this.prisma.client.user.findFirst({
      where: {
        id: principal.userId,
        salonId: principal.tenantId,
        role: 'OWNER',
        status: 'ACTIVE',
        salon: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        salonId: true,
        name: true,
        email: true,
        role: true,
        salon: { select: { accessState: true } },
      },
    });
    if (!user || user.salon.accessState !== 'PRODUCT') {
      throw new ForbiddenError();
    }
    const session = await signSalonSession(this.jwt, {
      id: user.id,
      salonId: user.salonId,
      role: user.role,
      accessState: 'PRODUCT',
    });
    if (session.sessionScope !== 'product') {
      throw new ForbiddenError();
    }
    await this.prisma.client.auditLog.create({
      data: {
        id: createId(),
        tenantId: user.salonId,
        actorId: user.id,
        action: 'SALON_SESSION_EXCHANGED',
        resource: 'user',
        resourceId: user.id,
        result: 'SUCCESS',
        metadata: {
          previousSessionScope: 'onboarding',
          sessionScope: session.sessionScope,
          accessState: 'PRODUCT',
          sessionId: session.sessionId,
        },
      },
    });
    return {
      accessToken: session.accessToken,
      sessionScope: session.sessionScope,
      accessState: 'PRODUCT' as const,
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
