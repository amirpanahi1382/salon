import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UnauthenticatedError, isUserRole, type AuthenticatedPrincipal } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

interface JwtPayload {
  sub: string;
  tid: string;
  role: string;
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

  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    if (!payload.sub || !payload.tid || !isUserRole(payload.role)) {
      throw new UnauthenticatedError('Invalid authentication token');
    }

    const user = await this.prisma.client.user.findFirst({
      where: {
        id: payload.sub,
        salonId: payload.tid,
        status: 'ACTIVE',
        salon: { status: 'ACTIVE' },
      },
      select: { id: true, salonId: true, role: true },
    });

    if (!user) {
      throw new UnauthenticatedError('Invalid authentication token');
    }

    return {
      userId: user.id,
      tenantId: user.salonId,
      role: user.role,
    };
  }
}
