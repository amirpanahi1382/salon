import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { toSalonProfileResponse } from './salon.mapper';

@Injectable()
export class GetSalonProfileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal) {
    const salon = await this.prisma.client.salon.findFirst({
      where: { id: principal.tenantId },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!salon) {
      throw new NotFoundError('Salon not found');
    }

    return toSalonProfileResponse(salon);
  }
}
