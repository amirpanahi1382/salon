import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  comparableJalaliMonthWindows,
  formatMoneyString,
  parseMoneyString,
  ValidationError,
  type AuthenticatedPrincipal,
  type ComparableJalaliMonthWindows,
} from '@salon/shared';
import {
  decodeCursor,
  encodeCursor,
  parseCursorInstant,
  parseCursorUuid,
  toListPage,
} from '../infrastructure/http/list-page';
import { PrismaService } from '../infrastructure/database/prisma.service';

export const REVENUE_DROP_PAGE_LIMIT = 50;

type RevenueDropSqlRow = {
  customerId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  previousAmount: string;
  currentAmount: string;
  differenceAmount: string;
};

export type RevenueDropItem = {
  customerId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  previousComparableAmount: string;
  currentAmount: string;
  differenceAmount: string;
  currency: 'IRR';
};

export type RevenueDropCursor = {
  asOf: Date;
  differenceAmount: string;
  customerId: string;
};

/**
 * Resolve evaluation instant and optional money/customer cursor.
 * First page (no cursor): use `now`. Continued pages reuse validated `asOf` from the cursor
 * so Jalali windows stay fixed for that browsing session. Refresh (omit cursor) starts a new evaluation.
 * Fixing `asOf` does not freeze ledger rows: a later VOID or amount change is still visible on a
 * subsequent page of the same cursor session (LIVE_READ pagination).
 */
export function resolveRevenueDropEvaluation(
  cursorValue: string | undefined,
  now: Date,
): { windows: ComparableJalaliMonthWindows; cursor?: Omit<RevenueDropCursor, 'asOf'> } {
  const cursorParts = decodeCursor(cursorValue, [3]);
  if (!cursorParts) {
    return { windows: comparableJalaliMonthWindows(now) };
  }
  const asOf = parseCursorInstant(cursorParts[0]!);
  return {
    windows: comparableJalaliMonthWindows(asOf),
    cursor: {
      differenceAmount: normalizeMoneyCursor(cursorParts[1]!),
      customerId: parseCursorUuid(cursorParts[2]!),
    },
  };
}

export function encodeRevenueDropCursor(
  asOf: Date,
  differenceAmount: string,
  customerId: string,
): string {
  return encodeCursor([
    asOf.toISOString(),
    formatMoneyString(parseMoneyString(normalizeDecimalText(differenceAmount))),
    customerId,
  ]);
}

@Injectable()
export class ListRevenueDropsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    principal: AuthenticatedPrincipal,
    cursorValue?: string,
    now = new Date(),
  ) {
    const { windows, cursor } = resolveRevenueDropEvaluation(cursorValue, now);
    const rows = await this.listPage(principal.tenantId, windows, cursor);
    const page = toListPage(rows, REVENUE_DROP_PAGE_LIMIT, (row) =>
      encodeRevenueDropCursor(windows.now, row.differenceAmount, row.customerId),
    );
    return {
      reportingTimezone: windows.timezone,
      asOf: windows.now.toISOString(),
      currentWindow: {
        startInclusive: windows.currentStart.toISOString(),
        endInclusive: windows.now.toISOString(),
      },
      previousComparableWindow: {
        startInclusive: windows.previousStart.toISOString(),
        endInclusive: windows.previousEndInclusive.toISOString(),
      },
      /**
       * Live read of COMPLETED ledger rows. Cursor carries a fixed `asOf` so every page in one
       * browsing session uses the same Jalali windows. That is not a database snapshot: voids or
       * new COMPLETED rows that land while paging can still change later pages. Omit the cursor
       * (refresh) to start a new evaluation instant. Visit counts are not used.
       */
      consistency: 'LIVE_READ' as const,
      explanation:
        'مبالغ فقط از تراکنش‌های تکمیل‌شده (غیر ابطال‌شده) است. بازهٔ ماه قبل تا همان نقطهٔ سپری‌شده از ماه جاری در تقویم جلالی Asia/Tehran مقایسه می‌شود؛ اگر ماه قبل کوتاه‌تر باشد، انتهای بازه به آخرین لحظهٔ همان ماه محدود می‌شود. صفحه‌بندی همان لحظهٔ ارزیابی را نگه می‌دارد؛ تازه‌سازی ارزیابی جدید می‌سازد.',
      items: page.items.map(toItem),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  private listPage(
    tenantId: string,
    windows: ComparableJalaliMonthWindows,
    cursor?: { differenceAmount: string; customerId: string },
  ): Promise<RevenueDropSqlRow[]> {
    const cursorSql = cursor
      ? Prisma.sql`AND (
          q.difference_amount < ${cursor.differenceAmount}::numeric
          OR (
            q.difference_amount = ${cursor.differenceAmount}::numeric
            AND q.customer_id < ${cursor.customerId}::uuid
          )
        )`
      : Prisma.empty;

    return this.prisma.client.$queryRaw<RevenueDropSqlRow[]>(Prisma.sql`
      WITH windowed AS (
        SELECT
          t.customer_id,
          COALESCE(
            SUM(t.amount) FILTER (
              WHERE t.occurred_at >= ${windows.previousStart}
                AND t.occurred_at < ${windows.previousEndExclusive}
            ),
            0
          ) AS previous_amount,
          COALESCE(
            SUM(t.amount) FILTER (
              WHERE t.occurred_at >= ${windows.currentStart}
                AND t.occurred_at <= ${windows.now}
            ),
            0
          ) AS current_amount
        FROM transactions t
        WHERE t.salon_id = ${tenantId}::uuid
          AND t.status = 'COMPLETED'::"TransactionStatus"
          AND (
            (
              t.occurred_at >= ${windows.previousStart}
              AND t.occurred_at < ${windows.previousEndExclusive}
            )
            OR (
              t.occurred_at >= ${windows.currentStart}
              AND t.occurred_at <= ${windows.now}
            )
          )
        GROUP BY t.customer_id
      ),
      qualified AS (
        SELECT
          w.customer_id,
          w.previous_amount,
          w.current_amount,
          (w.previous_amount - w.current_amount) AS difference_amount
        FROM windowed w
        WHERE w.previous_amount > w.current_amount
      )
      SELECT
        q.customer_id AS "customerId",
        c.first_name AS "firstName",
        c.last_name AS "lastName",
        c.phone_number AS "phoneNumber",
        q.previous_amount::text AS "previousAmount",
        q.current_amount::text AS "currentAmount",
        q.difference_amount::text AS "differenceAmount"
      FROM qualified q
      INNER JOIN customers c
        ON c.id = q.customer_id AND c.salon_id = ${tenantId}::uuid
      WHERE TRUE
        ${cursorSql}
      ORDER BY q.difference_amount DESC, q.customer_id DESC
      LIMIT ${REVENUE_DROP_PAGE_LIMIT + 1}
    `);
  }
}

function normalizeMoneyCursor(value: string): string {
  try {
    return formatMoneyString(parseMoneyString(value.includes('.') ? value : `${value}.00`));
  } catch {
    throw new ValidationError('Invalid cursor');
  }
}

function toItem(row: RevenueDropSqlRow): RevenueDropItem {
  const previous = formatMoneyString(parseMoneyString(normalizeDecimalText(row.previousAmount)));
  const current = formatMoneyString(parseMoneyString(normalizeDecimalText(row.currentAmount)));
  const difference = formatMoneyString(parseMoneyString(normalizeDecimalText(row.differenceAmount)));
  return {
    customerId: row.customerId,
    firstName: row.firstName,
    lastName: row.lastName,
    phoneNumber: row.phoneNumber,
    previousComparableAmount: previous,
    currentAmount: current,
    differenceAmount: difference,
    currency: 'IRR',
  };
}

/** Postgres numeric::text may omit trailing zeros; money helpers require at most 2 decimals. */
export function normalizeDecimalText(value: string): string {
  if (!value.includes('.')) {
    return `${value}.00`;
  }
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${`${fraction}00`.slice(0, 2)}`;
}
