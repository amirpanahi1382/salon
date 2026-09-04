import { Injectable } from '@nestjs/common';
import { type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SALON_USER_SELECT, toSalonUserResponse } from './user.mapper';

@Injectable()
export class ListSalonUsersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal) {
    const users = await this.prisma.client.user.findMany({
      where: { salonId: principal.tenantId },
      select: SALON_USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return users.map(toSalonUserResponse);
  }
}
