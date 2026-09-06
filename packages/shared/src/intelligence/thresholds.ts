/**
 * Phase 5 retention thresholds.
 *
 * Transactions and service mix do not exist yet, so these rules use completed
 * visits only. They are documented so they are not silent magic numbers.
 *
 * - DEFAULT_EXPECTED_RETURN_DAYS: used when a customer has fewer than two
 *   visits on different UTC days, so an interval cannot be measured.
 *   Aligns with the domain-model example (~35 day return cadence).
 * - INACTIVE_MULTIPLIER: inactive when days since last visit exceed
 *   expectedReturnInterval * this value (35 → 70 days in the default case).
 * - AT_RISK: last visit is past the expected interval but not yet inactive.
 * - FREQUENT: six or more visits and a measured average interval of 28 days
 *   or less. This is a signal, not a customer status.
 *
 * HIGH_VALUE segmentation is omitted until a salon-specific spend rule is chosen.
 * Revenue metrics come from COMPLETED transactions only (see revenue.ts).
 */
export const DEFAULT_EXPECTED_RETURN_DAYS = 35;
export const INACTIVE_MULTIPLIER = 2;
export const FREQUENT_MIN_VISITS = 6;
export const FREQUENT_MAX_AVERAGE_INTERVAL_DAYS = 28;

export const CUSTOMER_STATUSES = [
  'NEW',
  'ACTIVE',
  'RETURNING',
  'AT_RISK',
  'INACTIVE',
] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const OPPORTUNITY_TYPES = ['REACTIVATION', 'CUSTOMER_RETURN', 'REVENUE_DECLINE'] as const;

export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const INTELLIGENCE_SIGNALS = ['NEW_CUSTOMER', 'OVERDUE', 'FREQUENT', 'REVENUE_DECLINING'] as const;

export type IntelligenceSignal = (typeof INTELLIGENCE_SIGNALS)[number];
