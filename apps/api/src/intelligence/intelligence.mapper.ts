import type { CustomerBehavior, RetentionResult } from '@salon/shared';
import type {
  CustomerIntelligenceResponseDto,
  CustomerSegmentItemDto,
  OpportunityDto,
} from './intelligence.dto';

export type CustomerIdentity = {
  id: string;
  firstName: string;
  lastName: string;
};

export function toBehaviorDto(behavior: CustomerBehavior) {
  return {
    visitCount: behavior.visitCount,
    firstVisitAt: behavior.firstVisitAt?.toISOString() ?? null,
    lastVisitAt: behavior.lastVisitAt?.toISOString() ?? null,
    daysSinceLastVisit: behavior.daysSinceLastVisit,
    averageReturnIntervalDays: behavior.averageReturnIntervalDays,
    expectedReturnIntervalDays: behavior.expectedReturnIntervalDays,
  };
}

export function toCustomerIntelligenceResponse(
  customer: CustomerIdentity,
  behavior: CustomerBehavior,
  result: RetentionResult,
): CustomerIntelligenceResponseDto {
  return {
    customerId: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    status: result.status,
    explanation: result.explanation,
    behavior: toBehaviorDto(behavior),
    signals: result.signals,
    opportunities: result.opportunities.map((opportunity) =>
      toOpportunityDto(customer, result.status, opportunity),
    ),
  };
}

export function toOpportunityDto(
  customer: CustomerIdentity,
  status: RetentionResult['status'],
  opportunity: RetentionResult['opportunities'][number],
): OpportunityDto {
  return {
    type: opportunity.type,
    customerId: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    status,
    reason: opportunity.reason,
    recommendedAction: opportunity.recommendedAction,
  };
}

export function toSegmentItem(
  customer: CustomerIdentity,
  behavior: CustomerBehavior,
  result: RetentionResult,
): CustomerSegmentItemDto {
  return {
    customerId: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    status: result.status,
    explanation: result.explanation,
    daysSinceLastVisit: behavior.daysSinceLastVisit,
    visitCount: behavior.visitCount,
  };
}
