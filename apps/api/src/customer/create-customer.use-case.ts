import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  CUSTOMER_PHONE_RULE_MESSAGE,
  DOMAIN_EVENT_TYPES,
  isUsableCustomerPhone,
  normalizeCustomerPhone,
  sanitizeCustomerNamePart,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CustomerRepository } from './customer.repository';
import type { CreateCustomerDto } from './customer.dto';
import { toCustomerResponse } from './customer.mapper';

@Injectable()
export class CreateCustomerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateCustomerDto) {
    const firstName = sanitizeCustomerNamePart(input.firstName);
    const lastName = sanitizeCustomerNamePart(input.lastName ?? '');
    const phoneNumber = normalizeCustomerPhone(input.phoneNumber);

    if (!firstName) {
      throw new ValidationError('Customer first name is required');
    }
    if (lastName === null) {
      throw new ValidationError('Customer last name is invalid');
    }
    if (!isUsableCustomerPhone(phoneNumber)) {
      throw new ValidationError(CUSTOMER_PHONE_RULE_MESSAGE);
    }

    const duplicate = await this.customers.findByPhone(principal.tenantId, phoneNumber);
    if (duplicate) {
      throw new ConflictError('A customer with this phone number already exists in this salon');
    }

    const customerId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            id: customerId,
            salonId: principal.tenantId,
            firstName,
            lastName,
            phoneNumber,
            updatedAt: now,
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

        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.CustomerCreated,
            payload: { customerId, salonId: principal.tenantId },
          },
        });

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'CUSTOMER_CREATED',
            resource: 'customer',
            resourceId: customerId,
            result: 'SUCCESS',
          },
        });

        return customer;
      });

      return toCustomerResponse(created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A customer with this phone number already exists in this salon');
      }
      throw error;
    }
  }
}
