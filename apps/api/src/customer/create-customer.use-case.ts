import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { ConflictError, type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createCustomerInTransaction, requireCustomerIdentity } from './create-customer-record';
import type { CreateCustomerDto } from './customer.dto';
import { toCustomerResponse } from './customer.mapper';

@Injectable()
export class CreateCustomerUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateCustomerDto) {
    const identity = requireCustomerIdentity(input);
    const now = new Date();
    try {
      const created = await this.prisma.client.$transaction((tx) =>
        createCustomerInTransaction(tx, {
          salonId: principal.tenantId,
          actorId: principal.userId,
          identity,
          now,
          phoneConflict: 'ordinary',
        }),
      );
      return toCustomerResponse(created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A customer with this phone number already exists in this salon');
      }
      throw error;
    }
  }
}
