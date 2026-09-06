import type { CustomerBehavior, CustomerRevenueMetrics, RetentionResult } from '@salon/shared';
import {
  averageRevenuePerTransaction,
  averageSpendPerVisit,
  deriveRevenueTrend,
  formatMoneyString,
} from '@salon/shared';
import type {
  CustomerIntelligenceResponseDto,
  CustomerRevenueDto,
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

export function toRevenueDto(metrics: CustomerRevenueMetrics): CustomerRevenueDto {
  return {
    currency: 'IRR',
    totalRevenue: formatMoneyString(metrics.totalRevenueMinor),
    transactionCount: metrics.transactionCount,
    averageRevenuePerTransaction: averageRevenuePerTransaction(metrics),
    averageSpendPerVisit: averageSpendPerVisit(metrics),
    lastRevenueAt: metrics.lastRevenueAt?.toISOString() ?? null,
    revenueThisUtcMonth: formatMoneyString(metrics.thisUtcMonthMinor),
    revenuePreviousUtcMonth: formatMoneyString(metrics.previousUtcMonthMinor),
    revenueTrend: deriveRevenueTrend(metrics),
    reportingTime: 'UTC',
  };
}

export function toCustomerIntelligenceResponse(
  customer: CustomerIdentity,
  behavior: CustomerBehavior,
  result: RetentionResult,
  revenue: CustomerRevenueMetrics,
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
    revenue: toRevenueDto(revenue),
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
