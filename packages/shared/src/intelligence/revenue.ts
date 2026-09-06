import { formatMoneyString } from '../money.js';
import type { IntelligenceSignal, OpportunityType } from './thresholds.js';
import type { RetentionOpportunity } from './retention.js';

export const REVENUE_TRENDS = ['INCREASING', 'DECREASING', 'STABLE'] as const;
export type RevenueTrend = (typeof REVENUE_TRENDS)[number];

export type CustomerRevenueMetrics = {
  currency: 'IRR';
  totalRevenueMinor: bigint;
  transactionCount: number;
  linkedVisitCount: number;
  linkedRevenueMinor: bigint;
  lastRevenueAt: Date | null;
  thisUtcMonthMinor: bigint;
  previousUtcMonthMinor: bigint;
  previousUtcMonthTransactionCount: number;
};

export function utcMonthStart(asOf: Date): Date {
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
}

export function utcNextMonth(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export function deriveRevenueTrend(metrics: CustomerRevenueMetrics): RevenueTrend | null {
  if (metrics.previousUtcMonthTransactionCount < 1) {
    return null;
  }
  if (metrics.thisUtcMonthMinor > metrics.previousUtcMonthMinor) {
    return 'INCREASING';
  }
  if (metrics.thisUtcMonthMinor < metrics.previousUtcMonthMinor) {
    return 'DECREASING';
  }
  return 'STABLE';
}

export function averageRevenuePerTransaction(metrics: CustomerRevenueMetrics): string | null {
  if (metrics.transactionCount < 1) {
    return null;
  }
  return formatMoneyString(divideMinor(metrics.totalRevenueMinor, metrics.transactionCount));
}

export function averageSpendPerVisit(metrics: CustomerRevenueMetrics): string | null {
  if (metrics.linkedVisitCount < 1) {
    return null;
  }
  return formatMoneyString(divideMinor(metrics.linkedRevenueMinor, metrics.linkedVisitCount));
}

function divideMinor(total: bigint, count: number): bigint {
  const divisor = BigInt(count);
  return (total + divisor / 2n) / divisor;
}

export function emptyRevenueMetrics(): CustomerRevenueMetrics {
  return {
    currency: 'IRR',
    totalRevenueMinor: 0n,
    transactionCount: 0,
    linkedVisitCount: 0,
    linkedRevenueMinor: 0n,
    lastRevenueAt: null,
    thisUtcMonthMinor: 0n,
    previousUtcMonthMinor: 0n,
    previousUtcMonthTransactionCount: 0,
  };
}

export function revenueSignals(metrics: CustomerRevenueMetrics): IntelligenceSignal[] {
  return deriveRevenueTrend(metrics) === 'DECREASING' ? ['REVENUE_DECLINING'] : [];
}

export function revenueOpportunities(metrics: CustomerRevenueMetrics): RetentionOpportunity[] {
  if (deriveRevenueTrend(metrics) !== 'DECREASING') {
    return [];
  }
  const type: OpportunityType = 'REVENUE_DECLINE';
  return [
    {
      type,
      reason: `Completed revenue this UTC month is ${formatMoneyString(metrics.thisUtcMonthMinor)} IRR versus ${formatMoneyString(metrics.previousUtcMonthMinor)} IRR in the previous UTC month.`,
      recommendedAction: 'Review this customer’s recent decline.',
    },
  ];
}
