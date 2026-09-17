import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  createId,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
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
import { RecordCompletedVisit } from './record-completed-visit';
import { toVisitResponse } from './visit.mapper';
import { parseCompletedVisitedAt } from './visited-at';

@Injectable()
export class CreateVisitUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recordVisit: RecordCompletedVisit,
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

        return this.recordVisit.create(tx, {
          principal,
          customerId: input.customerId,
          visitedAt,
          visitId,
          now,
        });
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
