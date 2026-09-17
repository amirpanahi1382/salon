import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  requireIdempotencyKey,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { VisitRepository } from '../visit/visit.repository';
import type { LinkReturnCommitmentVisitDto } from './return-commitment.dto';
import {
  RETURN_COMMITMENT_LINK_VISIT_OPERATION,
  returnCommitmentLinkVisitRequestHash,
} from './return-commitment.idempotency';
import type { ReturnCommitmentRow } from './return-commitment.mapper';
import { ReturnCommitmentRepository } from './return-commitment.repository';

@Injectable()
export class LinkReturnCommitmentVisitUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: ReturnCommitmentRepository,
    private readonly visits: VisitRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    id: string,
    input: LinkReturnCommitmentVisitDto,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const requestHash = returnCommitmentLinkVisitRequestHash(id, input.visitId);
    const now = new Date();

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: RETURN_COMMITMENT_LINK_VISIT_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'return_commitment',
          resourceId: id,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: RETURN_COMMITMENT_LINK_VISIT_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Return commitment not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          const replay = await this.commitments.findById(principal.tenantId, existing.resourceId, tx);
          if (!replay) {
            throw new NotFoundError('Return commitment not found');
          }
          return this.commitments.toReadModel(principal.tenantId, replay as ReturnCommitmentRow, tx);
        }

        const locked = await this.commitments.lockByIdForUpdate(tx, principal.tenantId, id);
        if (!locked) {
          throw new NotFoundError('Return commitment not found');
        }

        const visit = await this.visits.findById(principal.tenantId, input.visitId, tx);
        if (!visit) {
          throw new NotFoundError('Visit not found');
        }
        if (visit.customerId !== locked.customerId) {
          throw new ConflictError('Visit does not belong to this customer');
        }

        if (locked.actualVisitId) {
          if (locked.actualVisitId === visit.id) {
            return this.commitments.toReadModel(principal.tenantId, locked, tx);
          }
          throw new ConflictError('Return commitment is already linked to an actual visit');
        }

        const alreadyLinked = await this.commitments.findByActualVisitId(
          principal.tenantId,
          visit.id,
          tx,
        );
        if (alreadyLinked && alreadyLinked.id !== id) {
          throw new ConflictError('Visit is already linked to a return commitment');
        }

        const linked = await this.commitments.linkActualVisit({
          tx,
          tenantId: principal.tenantId,
          id,
          visitId: visit.id,
          actorId: principal.userId,
          now,
        });
        if (linked.count === 0) {
          throw new ConflictError('Return commitment is already linked to an actual visit');
        }

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'RETURN_COMMITMENT_LINKED_TO_VISIT',
            resource: 'return_commitment',
            resourceId: id,
            result: 'SUCCESS',
            metadata: {
              customerId: locked.customerId,
              visitId: visit.id,
              visitedAt: visit.visitedAt.toISOString(),
              expectedAt: locked.expectedAt.toISOString(),
              sourceMessageRequestId: locked.sourceMessageRequestId,
              sourceMessageDeliveryId: locked.sourceMessageDeliveryId,
            },
          },
        });

        const row = await this.commitments.findById(principal.tenantId, id, tx);
        if (!row) {
          throw new NotFoundError('Return commitment not found');
        }
        return this.commitments.toReadModel(principal.tenantId, row as ReturnCommitmentRow, tx);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Visit not found');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}
