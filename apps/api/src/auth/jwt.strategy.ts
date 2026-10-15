import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  UnauthenticatedError,
  isUserRole,
  type RequestPrincipal,
  type SalonAccessState,
  type SessionScope,
} from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

interface JwtPayload {
  sub?: string;
  tid?: string;
  role?: string;
  scp?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.values.JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<RequestPrincipal> {
    if (!payload.sub) {
      throw new UnauthenticatedError('Invalid authentication token');
    }

    if (payload.scp === 'platform') {
      const admin = await this.prisma.client.platformAdmin.findFirst({
        where: { id: payload.sub, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!admin) {
        throw new UnauthenticatedError('Invalid authentication token');
      }
      return { kind: 'platform', adminId: admin.id };
    }

    if (payload.scp !== undefined && payload.scp !== 'onboarding') {
      throw new UnauthenticatedError('Invalid authentication token');
    }
    if (!payload.tid || !isUserRole(payload.role ?? '')) {
      throw new UnauthenticatedError('Invalid authentication token');
    }

    const sessionScope: SessionScope = payload.scp === 'onboarding' ? 'onboarding' : 'product';
    const user = await this.prisma.client.user.findFirst({
      where: {
        id: payload.sub,
        salonId: payload.tid,
        status: 'ACTIVE',
        salon: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        salonId: true,
        role: true,
        salon: { select: { accessState: true } },
      },
    });

    if (!user) {
      throw new UnauthenticatedError('Invalid authentication token');
    }

    const accessState = user.salon.accessState as SalonAccessState;
    if (sessionScope === 'product' && accessState !== 'PRODUCT') {
      throw new UnauthenticatedError('Invalid authentication token');
    }

    return {
      userId: user.id,
      tenantId: user.salonId,
      role: user.role,
      sessionScope,
      accessState,
    };
  }
}
