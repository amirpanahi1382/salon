import { Injectable } from '@nestjs/common';
import {
  associateObservedReturns,
  compareVisitsDescending,
  interventionOriginFromRequest,
  isEligibleCustomerMessageIntervention,
  type EligibleMessageIntervention,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { completedRevenueByVisitIds } from '../transaction/completed-visit-revenue';

@Injectable()
export class ObservedOutcomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAssociations(tenantId: string, customerId: string) {
    const [visits, deliveries] = await Promise.all([
      this.prisma.client.visit.findMany({
        where: { salonId: tenantId, customerId },
        select: { id: true, visitedAt: true, createdAt: true },
        orderBy: [{ visitedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.client.messageDelivery.findMany({
        where: {
          salonId: tenantId,
          customerId,
          status: 'SENT',
          submittedAt: { not: null },
        },
        select: {
          id: true,
          createdAt: true,
          submittedAt: true,
          customerId: true,
          actionId: true,
          messageRequest: {
            select: {
              id: true,
              customerId: true,
              requestedAt: true,
              actionId: true,
              opportunityType: true,
              vipRequestId: true,
              action: { select: { sourceVisitId: true } },
            },
          },
        },
      }),
    ]);

    const interventions: EligibleMessageIntervention[] = [];
    for (const row of deliveries) {
      const request = row.messageRequest;
      if (
        !isEligibleCustomerMessageIntervention(
          {
            requestCustomerId: request.customerId,
            requestVipRequestId: request.vipRequestId,
            deliveryCustomerId: row.customerId,
            deliveryStatus: 'SENT',
            submittedAt: row.submittedAt,
          },
          customerId,
        )
      ) {
        continue;
      }
      if (!row.submittedAt) {
        continue;
      }
      interventions.push({
        deliveryId: row.id,
        requestId: request.id,
        submittedAt: row.submittedAt,
        createdAt: row.createdAt,
        requestedAt: request.requestedAt,
        origin: interventionOriginFromRequest(request.actionId, request.opportunityType),
        opportunityType: request.opportunityType,
        actionId: request.actionId,
        sourceVisitId: request.action?.sourceVisitId ?? null,
      });
    }

    return associateObservedReturns(visits, interventions).sort((a, b) =>
      compareVisitsDescending(a.returnVisit, b.returnVisit),
    );
  }

  async completedRevenueByVisit(
    tenantId: string,
    customerId: string,
    visitIds: string[],
  ): Promise<Map<string, bigint>> {
    return completedRevenueByVisitIds(this.prisma.client, tenantId, customerId, visitIds);
  }
}
