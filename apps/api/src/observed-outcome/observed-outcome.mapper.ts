import {
  formatMoneyString,
  INTERVENTION_KIND_MESSAGE,
  OBSERVED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_RULE,
  type ObservedReturnAssociation,
} from '@salon/shared';
import type { ObservedReturnResponseDto } from './observed-outcome.dto';

export function toObservedReturnResponse(
  row: ObservedReturnAssociation,
  revenue: { recorded: boolean; amountMinor: bigint | null },
): ObservedReturnResponseDto {
  return {
    associationKind: OBSERVED_ASSOCIATION_KIND,
    associationRule: OBSERVED_ASSOCIATION_RULE,
    intervention: {
      kind: INTERVENTION_KIND_MESSAGE,
      origin: row.intervention.origin,
      occurredAt: row.intervention.submittedAt.toISOString(),
      message: {
        requestId: row.intervention.requestId,
        deliveryId: row.intervention.deliveryId,
        requestedAt: row.intervention.requestedAt.toISOString(),
      },
      actionId: row.intervention.actionId,
      opportunityType: row.intervention.opportunityType,
    },
    observedReturn: {
      visitId: row.returnVisit.id,
      occurredAt: row.returnVisit.visitedAt.toISOString(),
    },
    associatedRevenue: {
      recorded: revenue.recorded,
      currency: 'IRR',
      amount: revenue.recorded && revenue.amountMinor != null ? formatMoneyString(revenue.amountMinor) : null,
    },
  };
}
