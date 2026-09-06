import { Prisma, type PrismaClient } from '@salon/database';
import {
  emptyRevenueMetrics,
  parseMoneyString,
  utcMonthStart,
  utcNextMonth,
  type CustomerRevenueMetrics,
} from '@salon/shared';

type RevenueSqlRow = {
  customerId: string;
  total: string;
  transactionCount: number;
  linkedVisitCount: number;
  lastRevenueAt: Date | null;
  thisUtcMonth: string;
  previousUtcMonth: string;
  previousUtcMonthTransactionCount: number;
  linkedRevenue: string;
};

function toMetrics(row: RevenueSqlRow): CustomerRevenueMetrics {
  return {
    currency: 'IRR',
    totalRevenueMinor: parseMoneyString(row.total),
    transactionCount: Number(row.transactionCount),
    linkedVisitCount: Number(row.linkedVisitCount),
    linkedRevenueMinor: parseMoneyString(row.linkedRevenue),
    lastRevenueAt: row.lastRevenueAt,
    thisUtcMonthMinor: parseMoneyString(row.thisUtcMonth),
    previousUtcMonthMinor: parseMoneyString(row.previousUtcMonth),
    previousUtcMonthTransactionCount: Number(row.previousUtcMonthTransactionCount),
  };
}

function decimalString(value: unknown): string {
  if (value == null) {
    return '0.00';
  }
  const raw = String(value);
  const match = raw.match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?/);
  if (!match) {
    return '0.00';
  }
  const whole = match[1]!;
  const frac = `${match[2] ?? ''}00`.slice(0, 2);
  return `${whole}.${frac}`;
}

export async function loadCustomerRevenue(
  prisma: PrismaClient,
  tenantId: string,
  customerId: string,
  asOf: Date,
): Promise<CustomerRevenueMetrics> {
  const map = await loadCustomerRevenueMap(prisma, tenantId, asOf, customerId);
  return map.get(customerId) ?? emptyRevenueMetrics();
}

export async function loadCustomerRevenueMap(
  prisma: PrismaClient,
  tenantId: string,
  asOf: Date,
  customerId?: string,
): Promise<Map<string, CustomerRevenueMetrics>> {
  const monthStart = utcMonthStart(asOf);
  const nextMonth = utcNextMonth(monthStart);
  const previousStart = utcMonthStart(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1)));

  const rows = await prisma.$queryRaw<RevenueSqlRow[]>(Prisma.sql`
    SELECT
      customer_id AS "customerId",
      COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS total,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "transactionCount",
      COUNT(DISTINCT visit_id) FILTER (WHERE status = 'COMPLETED' AND visit_id IS NOT NULL)::int AS "linkedVisitCount",
      COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED' AND visit_id IS NOT NULL), 0)::text AS "linkedRevenue",
      MAX(occurred_at) FILTER (WHERE status = 'COMPLETED') AS "lastRevenueAt",
      COALESCE(SUM(amount) FILTER (
        WHERE status = 'COMPLETED' AND occurred_at >= ${monthStart} AND occurred_at < ${nextMonth}
      ), 0)::text AS "thisUtcMonth",
      COALESCE(SUM(amount) FILTER (
        WHERE status = 'COMPLETED' AND occurred_at >= ${previousStart} AND occurred_at < ${monthStart}
      ), 0)::text AS "previousUtcMonth",
      COUNT(*) FILTER (
        WHERE status = 'COMPLETED' AND occurred_at >= ${previousStart} AND occurred_at < ${monthStart}
      )::int AS "previousUtcMonthTransactionCount"
    FROM transactions
    WHERE salon_id = ${tenantId}::uuid
      ${customerId ? Prisma.sql`AND customer_id = ${customerId}::uuid` : Prisma.sql``}
    GROUP BY customer_id
  `);

  return new Map(rows.map((row) => [row.customerId, toMetrics(normalizeRow(row))]));
}

export async function loadSalonRevenueTotals(
  prisma: PrismaClient,
  tenantId: string,
  asOf: Date,
): Promise<CustomerRevenueMetrics> {
  const monthStart = utcMonthStart(asOf);
  const nextMonth = utcNextMonth(monthStart);
  const previousStart = utcMonthStart(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1)));

  const rows = await prisma.$queryRaw<RevenueSqlRow[]>(Prisma.sql`
    SELECT
      ${tenantId}::text AS "customerId",
      COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS total,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "transactionCount",
      COUNT(DISTINCT visit_id) FILTER (WHERE status = 'COMPLETED' AND visit_id IS NOT NULL)::int AS "linkedVisitCount",
      COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED' AND visit_id IS NOT NULL), 0)::text AS "linkedRevenue",
      MAX(occurred_at) FILTER (WHERE status = 'COMPLETED') AS "lastRevenueAt",
      COALESCE(SUM(amount) FILTER (
        WHERE status = 'COMPLETED' AND occurred_at >= ${monthStart} AND occurred_at < ${nextMonth}
      ), 0)::text AS "thisUtcMonth",
      COALESCE(SUM(amount) FILTER (
        WHERE status = 'COMPLETED' AND occurred_at >= ${previousStart} AND occurred_at < ${monthStart}
      ), 0)::text AS "previousUtcMonth",
      COUNT(*) FILTER (
        WHERE status = 'COMPLETED' AND occurred_at >= ${previousStart} AND occurred_at < ${monthStart}
      )::int AS "previousUtcMonthTransactionCount"
    FROM transactions
    WHERE salon_id = ${tenantId}::uuid
  `);
  const row = rows[0];
  return row ? toMetrics(normalizeRow(row)) : emptyRevenueMetrics();
}

function normalizeRow(row: RevenueSqlRow): RevenueSqlRow {
  return {
    ...row,
    total: decimalString(row.total),
    thisUtcMonth: decimalString(row.thisUtcMonth),
    previousUtcMonth: decimalString(row.previousUtcMonth),
    linkedRevenue: decimalString(row.linkedRevenue),
  };
}

export { emptyRevenueMetrics };
