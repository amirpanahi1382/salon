import { deriveCustomerBehavior } from './behavior';
import { RuleBasedRetentionAnalyzer } from './retention';
import { DEFAULT_EXPECTED_RETURN_DAYS } from './thresholds';

const analyzer = new RuleBasedRetentionAnalyzer();
const now = new Date('2026-09-05T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

describe('RuleBasedRetentionAnalyzer', () => {
  it('classifies a customer with no visits as NEW', () => {
    const behavior = deriveCustomerBehavior([], now);
    const result = analyzer.analyze(behavior);
    expect(behavior.expectedReturnIntervalDays).toBe(DEFAULT_EXPECTED_RETURN_DAYS);
    expect(result.status).toBe('NEW');
    expect(result.signals).toEqual(['NEW_CUSTOMER']);
    expect(result.opportunities).toEqual([]);
  });

  it('classifies a recent single visit as ACTIVE', () => {
    const behavior = deriveCustomerBehavior([daysAgo(5)], now);
    const result = analyzer.analyze(behavior);
    expect(result.status).toBe('ACTIVE');
    expect(result.explanation).toContain('5 days ago');
    expect(result.opportunities).toEqual([]);
  });

  it('classifies a recent repeat visitor as RETURNING', () => {
    const behavior = deriveCustomerBehavior([daysAgo(40), daysAgo(5)], now);
    const result = analyzer.analyze(behavior);
    expect(behavior.averageReturnIntervalDays).toBe(35);
    expect(result.status).toBe('RETURNING');
    expect(result.signals).not.toContain('OVERDUE');
  });

  it('classifies a customer past the expected interval as AT_RISK', () => {
    const behavior = deriveCustomerBehavior([daysAgo(87), daysAgo(52)], now);
    const result = analyzer.analyze(behavior);
    expect(behavior.averageReturnIntervalDays).toBe(35);
    expect(behavior.daysSinceLastVisit).toBe(52);
    expect(result.status).toBe('AT_RISK');
    expect(result.signals).toEqual(['OVERDUE']);
    expect(result.opportunities[0]?.type).toBe('REACTIVATION');
    expect(result.opportunities[0]?.reason).toContain('52 days ago');
    expect(result.opportunities[0]?.recommendedAction).toContain('reactivation');
  });

  it('classifies a long-inactive repeat customer as INACTIVE with reactivation', () => {
    const behavior = deriveCustomerBehavior([daysAgo(115), daysAgo(80)], now);
    const result = analyzer.analyze(behavior);
    expect(result.status).toBe('INACTIVE');
    expect(result.opportunities[0]?.type).toBe('REACTIVATION');
  });

  it('uses the default window for a single overdue visit (CUSTOMER_RETURN)', () => {
    const behavior = deriveCustomerBehavior([daysAgo(50)], now);
    const result = analyzer.analyze(behavior);
    expect(behavior.expectedReturnIntervalDays).toBe(DEFAULT_EXPECTED_RETURN_DAYS);
    expect(result.status).toBe('AT_RISK');
    expect(result.opportunities[0]?.type).toBe('CUSTOMER_RETURN');
  });

  it('marks a frequent customer who still returns on cadence', () => {
    const visits = [84, 70, 56, 42, 28, 14].map(daysAgo);
    const behavior = deriveCustomerBehavior(visits, now);
    const result = analyzer.analyze(behavior);
    expect(behavior.averageReturnIntervalDays).toBe(14);
    expect(result.status).toBe('RETURNING');
    expect(result.signals).toContain('FREQUENT');
  });

  it('does not treat same-day visits as a measured return interval', () => {
    const sameDay = new Date('2026-08-01T10:00:00.000Z');
    const later = new Date('2026-08-01T16:00:00.000Z');
    const behavior = deriveCustomerBehavior([sameDay, later], now);
    expect(behavior.visitCount).toBe(2);
    expect(behavior.averageReturnIntervalDays).toBeNull();
    expect(behavior.expectedReturnIntervalDays).toBe(DEFAULT_EXPECTED_RETURN_DAYS);
  });
});
