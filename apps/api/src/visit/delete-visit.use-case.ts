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
