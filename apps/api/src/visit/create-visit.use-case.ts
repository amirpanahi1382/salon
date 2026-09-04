import { Injectable } from '@nestjs/common';
import {
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { CreateVisitDto } from './visit.dto';
import { toVisitResponse } from './visit.mapper';
import { parseCompletedVisitedAt } from './visited-at';

@Injectable()
export class CreateVisitUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateVisitDto) {
    const visitedAt = parseCompletedVisitedAt(input.visitedAt);

    const customer = await this.customers.findById(principal.tenantId, input.customerId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const visitId = createId();
    const now = new Date();

    const created = await this.prisma.client.$transaction(async (tx) => {
      const visit = await tx.visit.create({
        data: {
          id: visitId,
          salonId: principal.tenantId,
          customerId: customer.id,
          visitedAt,
          updatedAt: now,
        },
        select: {
          id: true,
          customerId: true,
          visitedAt: true,
          createdAt: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          eventType: DOMAIN_EVENT_TYPES.VisitCompleted,
          payload: {
            visitId,
            customerId: customer.id,
            salonId: principal.tenantId,
            visitedAt: visitedAt.toISOString(),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'VISIT_CREATED',
          resource: 'visit',
          resourceId: visitId,
          result: 'SUCCESS',
          metadata: { customerId: customer.id },
        },
      });

      return visit;
    });

    return toVisitResponse(created);
  }
}
