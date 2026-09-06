import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import type { CreateVisitDto } from './visit.dto';
import {
  VISIT_CREATE_OPERATION,
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  visitCreateRequestHash,
} from './idempotency';
import { toVisitResponse } from './visit.mapper';
import { parseCompletedVisitedAt } from './visited-at';

@Injectable()
export class CreateVisitUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    input: CreateVisitDto,
    idempotencyKey?: string,
  ) {
    const visitedAt = parseCompletedVisitedAt(input.visitedAt);
    const requestHash = visitCreateRequestHash(input.customerId, visitedAt);
    const visitId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        if (idempotencyKey) {
          const claim = await claimIdempotencyKey(tx, {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: VISIT_CREATE_OPERATION,
            key: idempotencyKey,
            requestHash,
            resourceType: 'visit',
            resourceId: visitId,
          });

          if (!claim.inserted) {
            const existing = await findIdempotencyRecord(tx, {
              tenantId: principal.tenantId,
              actorId: principal.userId,
              operation: VISIT_CREATE_OPERATION,
              key: idempotencyKey,
            });
            if (!existing) {
              throw new NotFoundError('Visit not found');
            }
            assertSameIdempotentRequest(existing.requestHash, requestHash);
            const replay = await tx.visit.findFirst({
              where: { id: existing.resourceId, salonId: principal.tenantId },
              select: {
                id: true,
                customerId: true,
                visitedAt: true,
                createdAt: true,
              },
            });
            if (!replay) {
              throw new NotFoundError('Visit not found');
            }
            return replay;
          }
        }

        const customer = await this.customers.findById(
          principal.tenantId,
          input.customerId,
          tx,
        );
        if (!customer) {
          throw new NotFoundError('Customer not found');
        }

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
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Customer not found');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}
