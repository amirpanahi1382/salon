import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SALON_USER_SELECT, toSalonUserResponse } from './user.mapper';

@Injectable()
export class GetSalonUserUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal, userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, salonId: principal.tenantId },
      select: SALON_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return toSalonUserResponse(user);
  }
}
