import {
  averageRevenuePerTransaction,
  averageSpendPerVisit,
  deriveRevenueTrend,
  emptyRevenueMetrics,
  revenueOpportunities,
} from './revenue';

describe('revenue metrics', () => {
  it('does not invent a trend without previous UTC-month completed transactions', () => {
    const metrics = {
      ...emptyRevenueMetrics(),
      thisUtcMonthMinor: 10000n,
      previousUtcMonthTransactionCount: 0,
    };
    expect(deriveRevenueTrend(metrics)).toBeNull();
    expect(revenueOpportunities(metrics)).toEqual([]);
  });

  it('computes per-visit and per-transaction averages separately', () => {
    const metrics = {
      ...emptyRevenueMetrics(),
      totalRevenueMinor: 30000n,
      transactionCount: 2,
      linkedVisitCount: 1,
      linkedRevenueMinor: 30000n,
    };
    expect(averageRevenuePerTransaction(metrics)).toBe('150.00');
    expect(averageSpendPerVisit(metrics)).toBe('300.00');
  });

  it('returns null spend per visit when no completed transaction is linked to a visit', () => {
    const metrics = {
      ...emptyRevenueMetrics(),
      totalRevenueMinor: 10000n,
      transactionCount: 1,
      linkedVisitCount: 0,
    };
    expect(averageSpendPerVisit(metrics)).toBeNull();
  });
});
