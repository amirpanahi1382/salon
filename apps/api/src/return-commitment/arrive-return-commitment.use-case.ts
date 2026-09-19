import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  assertCurrencyIrr,
  ConflictError,
  createId,
  formatMoneyString,
  NotFoundError,
  parseMoneyString,
  ReturnCommitmentVisitReviewRequiredError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  requireIdempotencyKey,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { RecordCompletedVisit } from '../visit/record-completed-visit';
import { parseCompletedVisitedAt } from '../visit/visited-at';
import type { ArriveReturnCommitmentDto } from './return-commitment.dto';
import {
  RETURN_COMMITMENT_ARRIVE_OPERATION,
  returnCommitmentArriveRequestHash,
} from './return-commitment.idempotency';
import type { ReturnCommitmentRow } from './return-commitment.mapper';
import { ReturnCommitmentRepository } from './return-commitment.repository';

@Injectable()
export class ArriveReturnCommitmentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: ReturnCommitmentRepository,
    private readonly customers: CustomerRepository,
    private readonly recordVisit: RecordCompletedVisit,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    id: string,
    input: ArriveReturnCommitmentDto,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const visitedAt = parseCompletedVisitedAt(input.visitedAt);
    const sale = input.sale
      ? {
          serviceId: input.sale.serviceId,
          amount: formatMoneyString(parseMoneyString(input.sale.amount)),
          currency: assertCurrencyIrr(input.sale.currency),
        }
      : null;
    const requestHash = returnCommitmentArriveRequestHash({
      commitmentId: id,
      visitedAt: visitedAt.toISOString(),
      sale,
    });
    const visitId = createId();
    const transactionId = createId();
    const now = new Date();

    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: RETURN_COMMITMENT_ARRIVE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'return_commitment',
          resourceId: id,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: RETURN_COMMITMENT_ARRIVE_OPERATION,
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
        if (locked.actualVisitId) {
          throw new ConflictError('Return commitment is already linked to an actual visit');
        }

        const customer = await this.customers.lockByIdForUpdate(
          tx,
          principal.tenantId,
          locked.customerId,
        );
        if (!customer) {
          throw new NotFoundError('Customer not found');
        }

        const laterVisitExists = await this.commitments.hasQualifyingPostOutreachVisit(
          tx,
          principal.tenantId,
          locked.customerId,
          locked.sourceMessageDeliveryId,
        );
        if (laterVisitExists) {
          throw new ReturnCommitmentVisitReviewRequiredError();
        }

        if (input.sale) {
          await this.recordVisit.createWithSale(tx, {
            principal,
            customerId: locked.customerId,
            visitedAt,
            serviceId: input.sale.serviceId,
            amount: input.sale.amount,
            currency: input.sale.currency,
            visitId,
            transactionId,
            now,
          });
        } else {
          await this.recordVisit.create(tx, {
            principal,
            customerId: locked.customerId,
            visitedAt,
            visitId,
            now,
          });
        }

        const linked = await this.commitments.linkActualVisit({
          tx,
          tenantId: principal.tenantId,
          id,
          visitId,
          actor: { kind: 'SALON_USER', userId: principal.userId },
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
              visitId,
              visitedAt: visitedAt.toISOString(),
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

      return result;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Related record not found');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}
