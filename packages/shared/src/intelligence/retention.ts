import { deriveCustomerBehavior, type CustomerBehavior } from './behavior.js';
import {
  FREQUENT_MAX_AVERAGE_INTERVAL_DAYS,
  FREQUENT_MIN_VISITS,
  INACTIVE_MULTIPLIER,
  type CustomerStatus,
  type IntelligenceSignal,
  type OpportunityType,
} from './thresholds.js';

export type RetentionOpportunity = {
  type: OpportunityType;
  reason: string;
  recommendedAction: string;
};

export type RetentionResult = {
  status: CustomerStatus;
  explanation: string;
  signals: IntelligenceSignal[];
  opportunities: RetentionOpportunity[];
};

export interface RetentionAnalyzer {
  analyze(behavior: CustomerBehavior): RetentionResult;
}

export class RuleBasedRetentionAnalyzer implements RetentionAnalyzer {
  analyze(behavior: CustomerBehavior): RetentionResult {
    const status = classifyStatus(behavior);
    const explanation = explainStatus(behavior, status);
    const signals = collectSignals(behavior, status);
    const opportunities = collectOpportunities(behavior, status);
    return { status, explanation, signals, opportunities };
  }
}

export function analyzeCustomerVisits(
  visitDates: Date[],
  asOf: Date,
  analyzer: RetentionAnalyzer = new RuleBasedRetentionAnalyzer(),
): { behavior: CustomerBehavior; result: RetentionResult } {
  const behavior = deriveCustomerBehavior(visitDates, asOf);
  return { behavior, result: analyzer.analyze(behavior) };
}

function classifyStatus(behavior: CustomerBehavior): CustomerStatus {
  if (behavior.visitCount === 0) {
    return 'NEW';
  }

  const days = behavior.daysSinceLastVisit ?? 0;
  const expected = behavior.expectedReturnIntervalDays;
  const inactiveAfter = expected * INACTIVE_MULTIPLIER;

  if (days > inactiveAfter) {
    return 'INACTIVE';
  }
  if (days > expected) {
    return 'AT_RISK';
  }
  if (behavior.visitCount >= 2) {
    return 'RETURNING';
  }
  return 'ACTIVE';
}

function explainStatus(behavior: CustomerBehavior, status: CustomerStatus): string {
  const expected = behavior.expectedReturnIntervalDays;
  const days = behavior.daysSinceLastVisit;

  switch (status) {
    case 'NEW':
      return 'No completed visits recorded yet.';
    case 'ACTIVE':
      return `One completed visit ${days} days ago, still within the expected ${expected}-day return window.`;
    case 'RETURNING':
      return `Usually returns every ${expected} days. Last visit was ${days} days ago, within the expected window.`;
    case 'AT_RISK':
      return `Usually returns every ${expected} days. Last visit was ${days} days ago, which is past the expected return window.`;
    case 'INACTIVE':
      return `Usually returns every ${expected} days. Last visit was ${days} days ago, which is more than ${INACTIVE_MULTIPLIER}× the expected return interval.`;
  }
}

function collectSignals(
  behavior: CustomerBehavior,
  status: CustomerStatus,
): IntelligenceSignal[] {
  const signals: IntelligenceSignal[] = [];
  if (status === 'NEW') {
    signals.push('NEW_CUSTOMER');
  }
  if (status === 'AT_RISK' || status === 'INACTIVE') {
    signals.push('OVERDUE');
  }
  if (
    behavior.visitCount >= FREQUENT_MIN_VISITS &&
    behavior.averageReturnIntervalDays !== null &&
    behavior.averageReturnIntervalDays <= FREQUENT_MAX_AVERAGE_INTERVAL_DAYS
  ) {
    signals.push('FREQUENT');
  }
  return signals;
}

function collectOpportunities(
  behavior: CustomerBehavior,
  status: CustomerStatus,
): RetentionOpportunity[] {
  if (status !== 'AT_RISK' && status !== 'INACTIVE') {
    return [];
  }

  const explanation = explainStatus(behavior, status);

  if (behavior.visitCount >= 2) {
    return [
      {
        type: 'REACTIVATION',
        reason: explanation,
        recommendedAction: 'Send a reactivation message.',
      },
    ];
  }

  return [
    {
      type: 'CUSTOMER_RETURN',
      reason: explanation,
      recommendedAction: 'Invite the customer back for a follow-up visit.',
    },
  ];
}
