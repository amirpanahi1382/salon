export {
  deriveCustomerBehavior,
  wholeDaysBetween,
  type CustomerBehavior,
} from './behavior.js';
export {
  RuleBasedRetentionAnalyzer,
  analyzeCustomerVisits,
  analyzeCustomerBehavior,
  type RetentionAnalyzer,
  type RetentionOpportunity,
  type RetentionResult,
} from './retention.js';
export {
  CUSTOMER_STATUSES,
  DEFAULT_EXPECTED_RETURN_DAYS,
  FREQUENT_MAX_AVERAGE_INTERVAL_DAYS,
  FREQUENT_MIN_VISITS,
  INACTIVE_MULTIPLIER,
  INTELLIGENCE_SIGNALS,
  OPPORTUNITY_TYPES,
  type CustomerStatus,
  type IntelligenceSignal,
  type OpportunityType,
} from './thresholds.js';
