import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  BusinessRuleError,
  ConflictError,
  createId,
  isUsableCustomerPhone,
  normalizeCustomerPhone,
  NotFoundError,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CustomerRepository } from './customer.repository';
import type { UpdateCustomerDto } from './customer.dto';
import { toCustomerResponse } from './customer.mapper';

@Injectable()
export class UpdateCustomerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string, input: UpdateCustomerDto) {
    if (input.firstName === undefined && input.lastName === undefined && input.phoneNumber === undefined) {
      throw new BusinessRuleError('No customer fields to update');
    }

    const firstName = input.firstName !== undefined ? input.firstName.trim() : undefined;
    const lastName = input.lastName !== undefined ? input.lastName.trim() : undefined;
    const phoneNumber =
      input.phoneNumber !== undefined ? normalizeCustomerPhone(input.phoneNumber) : undefined;

    if (firstName !== undefined && firstName.length === 0) {
      throw new ValidationError('Customer first name is required');
    }
    if (lastName !== undefined && lastName.length === 0) {
      throw new ValidationError('Customer last name is required');
    }
    if (phoneNumber !== undefined && !isUsableCustomerPhone(phoneNumber)) {
      throw new ValidationError('A valid phone number is required');
    }

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const existing = await this.customers.findById(principal.tenantId, customerId, tx);
        if (!existing) {
          throw new NotFoundError('Customer not found');
        }

        if (phoneNumber && phoneNumber !== existing.phoneNumber) {
          const duplicate = await this.customers.findByPhone(principal.tenantId, phoneNumber, tx);
          if (duplicate) {
            throw new ConflictError('A customer with this phone number already exists in this salon');
          }
        }

        const customer = await tx.customer.update({
          where: { id: existing.id },
          data: {
            ...(firstName !== undefined ? { firstName } : {}),
            ...(lastName !== undefined ? { lastName } : {}),
            ...(phoneNumber !== undefined ? { phoneNumber } : {}),
            updatedAt: new Date(),
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'CUSTOMER_UPDATED',
            resource: 'customer',
            resourceId: existing.id,
            result: 'SUCCESS',
            metadata: {
              fields: Object.keys(input).filter((key) => input[key as keyof UpdateCustomerDto] !== undefined),
            },
          },
        });

        return customer;
      });

      return toCustomerResponse(updated);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A customer with this phone number already exists in this salon');
      }
      throw error;
    }
  }
}
