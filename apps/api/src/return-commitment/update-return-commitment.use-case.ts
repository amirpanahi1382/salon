import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  createId,
  isEligibleCustomerMessageIntervention,
  NotFoundError,
  ValidationError,
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
import { parseReturnCommitmentExpectedAt } from './expected-at';
import {
  RETURN_COMMITMENT_UPDATE_OPERATION,
  returnCommitmentUpdateRequestHash,
} from './return-commitment.idempotency';
import type { UpdateReturnCommitmentDto } from './return-commitment.dto';
import type { ReturnCommitmentRow } from './return-commitment.mapper';
import { ReturnCommitmentRepository } from './return-commitment.repository';

@Injectable()
export class UpdateReturnCommitmentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: ReturnCommitmentRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    id: string,
    input: UpdateReturnCommitmentDto,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const tokenUpdatedAt = parseUpdatedAtToken(input.updatedAt);
    const expectedAtPreview = new Date(input.expectedAt);
    if (Number.isNaN(expectedAtPreview.getTime())) {
      throw new ValidationError('expectedAt must be a valid timestamp');
    }
    const requestHash = returnCommitmentUpdateRequestHash(id, expectedAtPreview, tokenUpdatedAt);
    const now = new Date();

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: RETURN_COMMITMENT_UPDATE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'return_commitment',
          resourceId: id,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: RETURN_COMMITMENT_UPDATE_OPERATION,
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
          return replay as ReturnCommitmentRow;
        }

        const current = await this.commitments.lockByIdForUpdate(tx, principal.tenantId, id);
        if (!current) {
          throw new NotFoundError('Return commitment not found');
        }
        if (current.actualVisitId) {
          throw new ConflictError('Return commitment cannot be edited after an actual visit is linked');
        }

        const source = await this.commitments.findEligibleSource(
          principal.tenantId,
          current.sourceMessageRequestId,
          tx,
        );
        if (
          !source?.submittedAt ||
          !isEligibleCustomerMessageIntervention({
            requestCustomerId: source.requestCustomerId,
            requestVipRequestId: source.vipRequestId,
            deliveryCustomerId: source.deliveryCustomerId,
            deliveryStatus: source.deliveryStatus,
            submittedAt: source.submittedAt,
          })
        ) {
          throw new NotFoundError('Message not found');
        }

        const expectedAt = parseReturnCommitmentExpectedAt(input.expectedAt, source.submittedAt, now);
        const previousExpectedAt = current.expectedAt;

        const result = await this.commitments.updateExpectedAt({
          tx,
          tenantId: principal.tenantId,
          id,
          expectedAt,
          updatedAt: tokenUpdatedAt,
          actor: { kind: 'SALON_USER', userId: principal.userId },
          now,
        });
        if (result.count === 0) {
          throw new ConflictError('Return commitment was updated by another request');
        }

        const row = await this.commitments.findById(principal.tenantId, id, tx);
        if (!row) {
          throw new NotFoundError('Return commitment not found');
        }

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'RETURN_COMMITMENT_UPDATED',
            resource: 'return_commitment',
            resourceId: id,
            result: 'SUCCESS',
            metadata: {
              previousExpectedAt: previousExpectedAt.toISOString(),
              expectedAt: expectedAt.toISOString(),
            },
          },
        });

        return row as ReturnCommitmentRow;
      });

      return this.commitments.toReadModel(principal.tenantId, updated);
    } catch (error: unknown) {
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}

function parseUpdatedAtToken(value: string): Date {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new ValidationError('updatedAt must be a valid timestamp');
  }
  return updatedAt;
}
