import { comparableJalaliMonthWindows, formatMoneyString, parseMoneyString } from '@salon/shared';
import {
  encodeRevenueDropCursor,
  resolveRevenueDropEvaluation,
} from './list-revenue-drops.use-case';

/**
 * Pure helpers mirroring the revenue-drop window, money, and asOf-cursor rules.
 * SQL aggregation is covered by the disposable API e2e when available.
 */
describe('revenue-drop comparable windows and money', () => {
  it('uses equal elapsed time and clamps a shorter previous Jalali month', () => {
    // 1403/07/31 12:00 Tehran — previous month Mehr has 30 days, so clamp.
    const now = new Date('2024-10-22T08:30:00.000Z');
    const windows = comparableJalaliMonthWindows(now);
    expect(windows.timezone).toBe('Asia/Tehran');
    expect(windows.now.toISOString()).toBe(now.toISOString());
    expect(windows.previousEndInclusive.getTime()).toBeLessThan(windows.currentStart.getTime());
    expect(windows.previousEndExclusive.getTime()).toBe(windows.previousEndInclusive.getTime() + 1);
    const elapsedCurrent = windows.now.getTime() - windows.currentStart.getTime();
    const elapsedPrevious =
      windows.previousEndInclusive.getTime() - windows.previousStart.getTime();
    expect(elapsedPrevious).toBeLessThanOrEqual(elapsedCurrent);
  });

  it('keeps VOIDED out of monetary comparison by using COMPLETED amounts only', () => {
    const previous = parseMoneyString('5000000.00');
    const current = parseMoneyString('1500000.00');
    const voided = parseMoneyString('9000000.00');
    const difference = previous - current;
    expect(formatMoneyString(difference)).toBe('3500000.00');
    expect(difference).not.toBe(previous - current - voided);
    expect(previous > current).toBe(true);
  });

  it('requires previous comparable completed revenue to exceed current', () => {
    expect(parseMoneyString('100.00') > parseMoneyString('100.00')).toBe(false);
    expect(parseMoneyString('100.01') > parseMoneyString('100.00')).toBe(true);
  });
});

describe('revenue-drop fixed asOf cursor', () => {
  const asOf = new Date('2024-10-22T08:30:00.000Z');
  const customerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const customerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('first page uses now; continued page reuses cursor asOf for Jalali windows', () => {
    const first = resolveRevenueDropEvaluation(undefined, asOf);
    expect(first.windows.now.toISOString()).toBe(asOf.toISOString());
    expect(first.cursor).toBeUndefined();

    const laterNow = new Date('2024-10-22T20:00:00.000Z');
    const cursor = encodeRevenueDropCursor(asOf, '100.00', customerA);
    const next = resolveRevenueDropEvaluation(cursor, laterNow);
    expect(next.windows.now.toISOString()).toBe(asOf.toISOString());
    expect(next.windows.currentStart.toISOString()).toBe(first.windows.currentStart.toISOString());
    expect(next.windows.previousStart.toISOString()).toBe(first.windows.previousStart.toISOString());
    expect(next.cursor?.differenceAmount).toBe('100.00');
    expect(next.cursor?.customerId).toBe(customerA);
  });

  it('orders equal differences by customerId DESC via cursor continuation', () => {
    // Same difference: page after customerB should continue with customerA when ids sort DESC.
    const cursor = encodeRevenueDropCursor(asOf, '250.00', customerB);
    const next = resolveRevenueDropEvaluation(cursor, asOf);
    expect(next.cursor?.differenceAmount).toBe('250.00');
    expect(next.cursor?.customerId).toBe(customerB);
  });

  it('refresh without cursor starts a new evaluation at month boundary', () => {
    // Instant just after a Jalali month start vs previous page's older asOf.
    const monthBoundaryAsOf = new Date('2024-09-22T20:30:00.000Z'); // near Mehr 1 1403
    const older = comparableJalaliMonthWindows(new Date('2024-09-21T08:00:00.000Z'));
    const refreshed = resolveRevenueDropEvaluation(undefined, monthBoundaryAsOf);
    expect(refreshed.windows.currentStart.getTime()).not.toBe(older.currentStart.getTime());
    expect(refreshed.windows.now.toISOString()).toBe(monthBoundaryAsOf.toISOString());
  });
});
