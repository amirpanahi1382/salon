import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
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
  RETURN_COMMITMENT_CREATE_OPERATION,
  returnCommitmentCreateRequestHash,
} from './return-commitment.idempotency';
import type { CreateReturnCommitmentDto } from './return-commitment.dto';
import type { ReturnCommitmentRow } from './return-commitment.mapper';
import { ReturnCommitmentRepository } from './return-commitment.repository';

@Injectable()
export class CreateReturnCommitmentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: ReturnCommitmentRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    messageRequestId: string,
    input: CreateReturnCommitmentDto,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const expectedAtInput = new Date(input.expectedAt);
    if (Number.isNaN(expectedAtInput.getTime())) {
      throw new ValidationError('expectedAt must be a valid timestamp');
    }
    const requestHash = returnCommitmentCreateRequestHash(messageRequestId, expectedAtInput);
    const commitmentId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: RETURN_COMMITMENT_CREATE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'return_commitment',
          resourceId: commitmentId,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: RETURN_COMMITMENT_CREATE_OPERATION,
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

        const source = await this.commitments.findEligibleSource(principal.tenantId, messageRequestId, tx);
        if (!source) {
          throw new NotFoundError('Message not found');
        }
        if (
          !source.deliveryId ||
          !isEligibleCustomerMessageIntervention({
            requestCustomerId: source.requestCustomerId,
            requestVipRequestId: source.vipRequestId,
            deliveryCustomerId: source.deliveryCustomerId,
            deliveryStatus: source.deliveryStatus,
            submittedAt: source.submittedAt,
          })
        ) {
          throw new ValidationError('Message is not an eligible SENT customer outreach');
        }

        const expectedAt = parseReturnCommitmentExpectedAt(
          input.expectedAt,
          source.submittedAt!,
          now,
        );

        const inserted = await this.commitments.insertIfAbsent(tx, {
          id: commitmentId,
          salonId: principal.tenantId,
          customerId: source.customerId,
          sourceMessageRequestId: source.requestId,
          sourceMessageDeliveryId: source.deliveryId,
          expectedAt,
          actor: { kind: 'SALON_USER', userId: principal.userId },
          now,
        });
        if (!inserted) {
          throw new ConflictError('A return commitment already exists for this outreach');
        }

        const row = await this.commitments.findById(principal.tenantId, commitmentId, tx);
        if (!row) {
          throw new NotFoundError('Return commitment not found');
        }

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'RETURN_COMMITMENT_CREATED',
            resource: 'return_commitment',
            resourceId: commitmentId,
            result: 'SUCCESS',
            metadata: {
              customerId: source.customerId,
              sourceMessageRequestId: source.requestId,
              sourceMessageDeliveryId: source.deliveryId,
              expectedAt: expectedAt.toISOString(),
            },
          },
        });

        return row as ReturnCommitmentRow;
      });

      return this.commitments.toReadModel(principal.tenantId, created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Message not found');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}
