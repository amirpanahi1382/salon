import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  isEligibleCustomerMessageIntervention,
  NotFoundError,
  ValidationError,
  type PlatformAdminPrincipal,
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
  RETURN_COMMITMENT_UPDATE_OPERATION,
  returnCommitmentCreateRequestHash,
  returnCommitmentUpdateRequestHash,
} from './return-commitment.idempotency';
import type { CreateReturnCommitmentDto, UpdateReturnCommitmentDto } from './return-commitment.dto';
import type { ReturnCommitmentRow } from './return-commitment.mapper';
import { ReturnCommitmentRepository } from './return-commitment.repository';

@Injectable()
export class AdminCreateReturnCommitmentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: ReturnCommitmentRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
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
        const source = await this.commitments.findEligibleSourceByRequestId(messageRequestId, tx);
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

        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: source.salonId,
          actorId: admin.adminId,
          operation: RETURN_COMMITMENT_CREATE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'return_commitment',
          resourceId: commitmentId,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: source.salonId,
            actorId: admin.adminId,
            operation: RETURN_COMMITMENT_CREATE_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Return commitment not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          const replay = await this.commitments.findById(source.salonId, existing.resourceId, tx);
          if (!replay) {
            throw new NotFoundError('Return commitment not found');
          }
          return { salonId: source.salonId, row: replay as ReturnCommitmentRow };
        }

        const expectedAt = parseReturnCommitmentExpectedAt(
          input.expectedAt,
          source.submittedAt!,
          now,
        );

        const inserted = await this.commitments.insertIfAbsent(tx, {
          id: commitmentId,
          salonId: source.salonId,
          customerId: source.customerId,
          sourceMessageRequestId: source.requestId,
          sourceMessageDeliveryId: source.deliveryId,
          expectedAt,
          actor: { kind: 'PLATFORM_ADMIN', adminId: admin.adminId },
          now,
        });
        if (!inserted) {
          throw new ConflictError('A return commitment already exists for this outreach');
        }

        const row = await this.commitments.findById(source.salonId, commitmentId, tx);
        if (!row) {
          throw new NotFoundError('Return commitment not found');
        }

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: source.salonId,
            actorId: admin.adminId,
            action: 'RETURN_COMMITMENT_CREATED',
            resource: 'return_commitment',
            resourceId: commitmentId,
            result: 'SUCCESS',
            metadata: {
              customerId: source.customerId,
              sourceMessageRequestId: source.requestId,
              sourceMessageDeliveryId: source.deliveryId,
              expectedAt: expectedAt.toISOString(),
              recordedBy: 'PLATFORM_ADMIN',
            },
          },
        });

        return { salonId: source.salonId, row: row as ReturnCommitmentRow };
      });

      return this.commitments.toReadModel(created.salonId, created.row);
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

@Injectable()
export class AdminUpdateReturnCommitmentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: ReturnCommitmentRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
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
        const currentLookup = await tx.returnCommitment.findFirst({
          where: { id },
          select: { salonId: true },
        });
        if (!currentLookup) {
          throw new NotFoundError('Return commitment not found');
        }

        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: currentLookup.salonId,
          actorId: admin.adminId,
          operation: RETURN_COMMITMENT_UPDATE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'return_commitment',
          resourceId: id,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: currentLookup.salonId,
            actorId: admin.adminId,
            operation: RETURN_COMMITMENT_UPDATE_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Return commitment not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          const replay = await this.commitments.findById(
            currentLookup.salonId,
            existing.resourceId,
            tx,
          );
          if (!replay) {
            throw new NotFoundError('Return commitment not found');
          }
          return { salonId: currentLookup.salonId, row: replay as ReturnCommitmentRow };
        }

        const current = await this.commitments.lockByIdForUpdate(tx, currentLookup.salonId, id);
        if (!current) {
          throw new NotFoundError('Return commitment not found');
        }
        if (current.actualVisitId) {
          throw new ConflictError('Return commitment cannot be edited after an actual visit is linked');
        }

        const source = await this.commitments.findEligibleSource(
          currentLookup.salonId,
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
          tenantId: currentLookup.salonId,
          id,
          expectedAt,
          updatedAt: tokenUpdatedAt,
          actor: { kind: 'PLATFORM_ADMIN', adminId: admin.adminId },
          now,
        });
        if (result.count === 0) {
          throw new ConflictError('Return commitment was updated by another request');
        }

        const row = await this.commitments.findById(currentLookup.salonId, id, tx);
        if (!row) {
          throw new NotFoundError('Return commitment not found');
        }

        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: currentLookup.salonId,
            actorId: admin.adminId,
            action: 'RETURN_COMMITMENT_UPDATED',
            resource: 'return_commitment',
            resourceId: id,
            result: 'SUCCESS',
            metadata: {
              previousExpectedAt: previousExpectedAt.toISOString(),
              expectedAt: expectedAt.toISOString(),
              recordedBy: 'PLATFORM_ADMIN',
            },
          },
        });

        return { salonId: currentLookup.salonId, row: row as ReturnCommitmentRow };
      });

      return this.commitments.toReadModel(updated.salonId, updated.row);
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
