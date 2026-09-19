import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VisitRepository } from './visit.repository';

@Injectable()
export class DeleteVisitUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visits: VisitRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, visitId: string) {
    const existing = await this.visits.findById(principal.tenantId, visitId);
    if (!existing) {
      throw new NotFoundError('Visit not found');
    }

    await this.prisma.client.$transaction(async (tx) => {
      const linked = await tx.ledgerTransaction.count({
        where: { salonId: principal.tenantId, visitId: existing.id },
      });
      if (linked > 0) {
        throw new ConflictError('Visit cannot be deleted while financial records reference it');
      }

      const now = new Date();
      const commitments = await tx.$queryRaw<
        Array<{
          id: string;
          customer_id: string;
          expected_at: Date;
        }>
      >`
        SELECT id, customer_id, expected_at
        FROM return_commitments
        WHERE salon_id = ${principal.tenantId}::uuid
          AND actual_visit_id = ${existing.id}::uuid
        FOR UPDATE
      `;

      if (commitments.length > 0) {
        await tx.returnCommitment.updateMany({
          where: {
            salonId: principal.tenantId,
            actualVisitId: existing.id,
          },
          data: {
            actualVisitId: null,
            updatedByUserId: principal.userId,
            updatedByPlatformAdminId: null,
            updatedAt: now,
          },
        });
        for (const commitment of commitments) {
          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              actorId: principal.userId,
              action: 'RETURN_COMMITMENT_UNLINKED_FROM_VISIT',
              resource: 'return_commitment',
              resourceId: commitment.id,
              result: 'SUCCESS',
              metadata: {
                visitId: existing.id,
                customerId: commitment.customer_id,
                expectedAt: commitment.expected_at.toISOString(),
              },
            },
          });
        }
      }

      const deleted = await this.visits.deleteById(principal.tenantId, existing.id, tx);
      if (deleted.count === 0) {
        throw new NotFoundError('Visit not found');
      }

      await tx.outboxEvent.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          eventType: DOMAIN_EVENT_TYPES.VisitDeleted,
          payload: {
            visitId: existing.id,
            customerId: existing.customerId,
            salonId: principal.tenantId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'VISIT_DELETED',
          resource: 'visit',
          resourceId: existing.id,
          result: 'SUCCESS',
          metadata: { customerId: existing.customerId, salonId: principal.tenantId },
        },
      });
    });
  }
}
