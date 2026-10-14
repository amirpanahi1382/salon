import type { VipRequestStatus } from './vip.js';
import { VIP_RESERVATION_TTL_MS } from './vip.js';

export const VIP_PROGRESS_AUDIENCES = ['SALON', 'PLATFORM_ADMIN'] as const;
export type VipProgressAudience = (typeof VIP_PROGRESS_AUDIENCES)[number];

export const VIP_PROGRESS_NEXT_ACTORS = ['SALON', 'PLATFORM_ADMIN', 'NONE'] as const;
export type VipProgressNextActor = (typeof VIP_PROGRESS_NEXT_ACTORS)[number];

export const VIP_PROGRESS_COUNT_KEYS = [
  'notYetQueued',
  'inHandling',
  'manuallyMarkedSent',
  'failed',
  'cancelledMessage',
  'durablySkipped',
  'unclassifiedSent',
] as const;
export type VipProgressCountKey = (typeof VIP_PROGRESS_COUNT_KEYS)[number];

export type VipProgressCountLine = {
  key: VipProgressCountKey;
  label: string;
  count: number;
};

/**
 * Read-only composition of a VipRequest with messaging execution and stop outcomes.
 * Audience changes the sentences. It does not create a VipRequest status and does not
 * treat dispatch or a manual sent mark as provider delivery.
 */
export type VipRequestProgress = {
  headline: string;
  explanation: string;
  nextActor: VipProgressNextActor;
  nextActorLabel: string;
  reservationStillValid: boolean;
  latestActionLabel: string | null;
  latestActionAt: string | null;
  countLines: VipProgressCountLine[];
  countsOmittedReason: string | null;
  activeStopNote: string | null;
  listReservationNote: string | null;
  requestedCountNote: string | null;
};

export type VipProgressFacts = {
  status: string;
  now: Date;
  createdAt: Date;
  reservedUntil: Date;
  submittedAt: Date | null;
  cancelledAt: Date | null;
  requestedCount: number;
  recipientCount: number;
  notYetQueuedCount: number;
  queuedCount: number;
  inPipelineCount: number;
  sentCount: number;
  manualSentCount: number;
  failedCount: number;
  cancelledMessageCount: number;
  durablySkippedCount: number;
  activeStopWithoutDurableSkipCount: number;
  latestManualSentAt: Date | null;
};

const SALON_RECORDED_HEADLINE = 'درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود';
const SALON_OPEN_OUTCOMES_HEADLINE =
  'درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید';
const SALON_CLOSED_WITHOUT_SEND_HEADLINE = 'رسیدگی پایان یافت؛ ارسالی برای این درخواست ثبت نشد';
const SALON_CLOSED_WITH_SEND_HEADLINE =
  'رسیدگی به این درخواست پایان یافت؛ نتیجهٔ هر گیرنده را پایین ببینید';

const COUNT_LABELS: Record<VipProgressAudience, Record<VipProgressCountKey, string>> = {
  SALON: {
    notYetQueued: 'هنوز به صف پیام نرسیده',
    inHandling: 'در حال رسیدگی',
    manuallyMarkedSent: 'علامت‌خورده به‌عنوان ارسال دستی',
    failed: 'ارسال ناموفق',
    cancelledMessage: 'از صف پیام خارج شده',
    durablySkipped: 'برای این درخواست دیگر پیام نمی‌گیرد',
    unclassifiedSent: 'ارسال ثبت‌شده بدون علامت دستی معلوم',
  },
  PLATFORM_ADMIN: {
    notYetQueued: 'هنوز در صف پیام نیست',
    inHandling: 'در صف یا در حال رسیدگی',
    manuallyMarkedSent: 'علامت‌خورده به‌عنوان ارسال دستی',
    failed: 'ارسال ناموفق',
    cancelledMessage: 'لغو شده از صف',
    durablySkipped: 'رد پایدار همین درخواست',
    unclassifiedSent: 'ارسال ثبت‌شده بدون حالت دستی معلوم',
  },
};

type NoneKind = 'DRAFT_CLOSED' | 'HANDLING_SETTLED';

function reservationMinutes(): string {
  return persianDigits(Math.round(VIP_RESERVATION_TTL_MS / 60_000));
}

function nextActorLabel(
  actor: VipProgressNextActor,
  audience: VipProgressAudience,
  noneKind: NoneKind,
): string {
  if (actor === 'SALON') return 'اقدام بعدی با سالن است';
  if (actor === 'PLATFORM_ADMIN') {
    return audience === 'SALON' ? 'ادامهٔ کار با تأیید ادمین است' : 'اقدام بعدی با پلتفرم است';
  }
  if (audience === 'PLATFORM_ADMIN') return 'اقدام ارسال دیگری برای این درخواست نمانده است';
  if (noneKind === 'HANDLING_SETTLED') return 'نتیجهٔ هر گیرنده در شمارش پایین است';
  return 'برای این پیش‌نویس کار دیگری نمانده است';
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The approved registration sentence stays only while no recipient has a recorded
 * outcome. A manual SENT mark counts as a recorded send, not as provider delivery.
 */
function salonExecutionHeadline(facts: VipProgressFacts, messagesSettled: boolean): string {
  const unclassifiedSent = facts.sentCount - facts.manualSentCount;
  const hasRecordedOutcome =
    facts.manualSentCount > 0 ||
    unclassifiedSent > 0 ||
    facts.failedCount > 0 ||
    facts.cancelledMessageCount > 0 ||
    facts.durablySkippedCount > 0;
  if (!hasRecordedOutcome) {
    return SALON_RECORDED_HEADLINE;
  }
  if (!messagesSettled) {
    return SALON_OPEN_OUTCOMES_HEADLINE;
  }
  if (facts.sentCount === 0) {
    return SALON_CLOSED_WITHOUT_SEND_HEADLINE;
  }
  return SALON_CLOSED_WITH_SEND_HEADLINE;
}

function persianDigits(value: number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit);
}

/** Expiry is known only when the stored row was closed before submission. */
export function vipDraftReservationExpired(facts: Pick<VipProgressFacts, 'status' | 'cancelledAt' | 'submittedAt'>): boolean {
  return facts.status === 'CANCELLED' && facts.cancelledAt != null && facts.submittedAt == null;
}

export function deriveVipRequestProgress(
  facts: VipProgressFacts,
  audience: VipProgressAudience,
): VipRequestProgress {
  const inHandling = facts.queuedCount + facts.inPipelineCount;
  const unclassifiedSent = facts.sentCount - facts.manualSentCount;
  const partition =
    facts.notYetQueuedCount +
    inHandling +
    facts.sentCount +
    facts.failedCount +
    facts.cancelledMessageCount +
    facts.durablySkippedCount;
  const countsTrustworthy =
    facts.recipientCount >= 0 &&
    unclassifiedSent >= 0 &&
    facts.manualSentCount >= 0 &&
    facts.activeStopWithoutDurableSkipCount >= 0 &&
    partition === facts.recipientCount;
  const reservationStillValid =
    facts.status === 'AWAITING_SAMPLE_WORK' && facts.reservedUntil.getTime() >= facts.now.getTime();
  const handlingOpen = facts.notYetQueuedCount + inHandling > 0;
  const messagesSettled =
    facts.status === 'MANUAL_QUEUED' && facts.recipientCount > 0 && countsTrustworthy && !handlingOpen;

  const narrative = narrativeFor(facts, audience, {
    reservationStillValid,
    messagesSettled,
    countsTrustworthy,
  });

  const countLines: VipProgressCountLine[] = [];
  if (countsTrustworthy && facts.recipientCount > 0) {
    const lines: Array<[VipProgressCountKey, number]> = [
      ['notYetQueued', facts.notYetQueuedCount],
      ['inHandling', inHandling],
      ['manuallyMarkedSent', facts.manualSentCount],
      ['failed', facts.failedCount],
      ['cancelledMessage', facts.cancelledMessageCount],
      ['durablySkipped', facts.durablySkippedCount],
    ];
    if (unclassifiedSent > 0) lines.push(['unclassifiedSent', unclassifiedSent]);
    for (const [key, count] of lines) {
      countLines.push({ key, label: COUNT_LABELS[audience][key], count });
    }
  }

  const latest = latestAction(facts);
  const skippedNote =
    facts.durablySkippedCount > 0
      ? audience === 'SALON'
        ? ' این گیرنده‌ها برای همین درخواست پیام نمی‌گیرند، حتی اگر توقف کلی برداشته شود.'
        : ' رد پایدار با برداشتن توقف سراسری باز نمی‌شود.'
      : '';

  return {
    headline: narrative.headline,
    explanation: `${narrative.explanation}${skippedNote}`,
    nextActor: narrative.nextActor,
    nextActorLabel: nextActorLabel(narrative.nextActor, audience, narrative.noneKind),
    reservationStillValid,
    latestActionLabel: latest?.label ?? null,
    latestActionAt: latest ? iso(latest.at) : null,
    countLines,
    countsOmittedReason: countsTrustworthy
      ? null
      : 'شمارش گیرنده‌ها با ردیف‌های شناخته‌شده یکی نیست و نشان داده نمی‌شود.',
    activeStopNote:
      facts.activeStopWithoutDurableSkipCount > 0
        ? audience === 'SALON'
          ? `برای ${persianDigits(facts.activeStopWithoutDurableSkipCount)} گیرنده الان توقف کلی فعال است. این تعداد جدا از شمارش گیرنده‌هاست و با گیرنده‌هایی که برای همین درخواست دیگر پیام نمی‌گیرند یکی نیست.`
          : `برای ${persianDigits(facts.activeStopWithoutDurableSkipCount)} گیرنده توقف سراسری الان فعال است. این عدد در جمع گیرنده‌ها دوباره حساب نمی‌شود و با رد پایدار همین درخواست یکی نیست.`
        : null,
    listReservationNote:
      facts.status === 'AWAITING_SAMPLE_WORK'
        ? 'رزرو فهرست یعنی این فهرست برای تکمیل همین پیش‌نویس نگه داشته شده است، نه اینکه پیامی در حال ارسال باشد.'
        : null,
    requestedCountNote:
      countsTrustworthy && facts.requestedCount !== facts.recipientCount
        ? 'شمارش از ردیف‌های گیرنده است، نه از عدد درخواستی.'
        : null,
  };
}

function narrativeFor(
  facts: VipProgressFacts,
  audience: VipProgressAudience,
  flags: { reservationStillValid: boolean; messagesSettled: boolean; countsTrustworthy: boolean },
): { headline: string; explanation: string; nextActor: VipProgressNextActor; noneKind: NoneKind } {
  const minutes = reservationMinutes();
  const salon = audience === 'SALON';
  switch (facts.status as VipRequestStatus) {
    case 'AWAITING_SAMPLE_WORK':
      if (flags.reservationStillValid) {
        return salon
          ? {
              headline: 'در انتظار ارسال نمونه‌کارهای شما',
              explanation: `تا پایان مهلت ${minutes} دقیقه‌ای رزرو، نمونه‌کار را بارگذاری کنید و درخواست را ثبت کنید. هنوز پیامی ساخته نشده است.`,
              nextActor: 'SALON',
              noneKind: 'DRAFT_CLOSED',
            }
          : {
              headline: 'پیش‌نویس باز است',
              explanation:
                'سالن باید تا پایان مهلت رزرو نمونه‌کار را بارگذاری و درخواست را ثبت کند. هنوز پیامی ساخته نشده است.',
              nextActor: 'SALON',
              noneKind: 'DRAFT_CLOSED',
            };
      }
      return salon
        ? {
            headline: 'دوباره تلاش کنید',
            explanation: `مهلت ${minutes} دقیقه‌ای تکمیل این پیش‌نویس تمام شده است. از این پیش‌نویس پیامی ارسال نشده است. اگر هنوز مجاز باشید، یک درخواست جدید شروع کنید.`,
            nextActor: 'NONE',
            noneKind: 'DRAFT_CLOSED',
          }
        : {
            headline: 'مهلت رزرو این پیش‌نویس گذشته است',
            explanation:
              'تا وقتی لغو ثبت شود، این پایان مهلت پیش‌نویس است، نه شکست ارسال. پیامی از این پیش‌نویس ساخته نشده است.',
            nextActor: 'NONE',
            noneKind: 'DRAFT_CLOSED',
          };
    case 'SUBMITTED':
    case 'MANUAL_QUEUED':
    case 'BALE_NOT_IMPLEMENTED':
      if (salon) {
        return {
          headline: salonExecutionHeadline(facts, flags.messagesSettled),
          explanation:
            'این عنوان فقط ثبت درخواست است و به معنای ارسال یا تحویل پیام نیست. علامت ارسال دستی تحویل قطعی پیام نیست و نتیجهٔ ناموفق، لغو یا ارسال‌نشدن پنهان نمی‌شود.',
          nextActor: flags.messagesSettled ? 'NONE' : 'PLATFORM_ADMIN',
          noneKind: 'HANDLING_SETTLED',
        };
      }
      return adminDispatchNarrative(facts, flags);
    case 'CANCELLED':
      if (vipDraftReservationExpired(facts)) {
        return salon
          ? {
              headline: 'اتمام مهلت ارسال درخواست',
              explanation: `مهلت ${minutes} دقیقه‌ای تکمیل این پیش‌نویس تمام شد و پیش‌نویس بسته شده است. از این پیش‌نویس پیامی ارسال نشده است. این پایان مهلت پیش‌نویس است، نه ناموفق بودن یک ارسال.`,
              nextActor: 'NONE',
              noneKind: 'DRAFT_CLOSED',
            }
          : {
              headline: 'پیش‌نویس به‌خاطر پایان مهلت رزرو بسته شد',
              explanation:
                'زمان بستن پیش‌نویس ثبت شده و این درخواست ثبت نهایی نشده است. این لغو پیش‌نویس است، نه شکست ارسال پیام.',
              nextActor: 'NONE',
              noneKind: 'DRAFT_CLOSED',
            };
      }
      return {
        headline: 'درخواست لغو شده است',
        explanation: salon
          ? 'علت لغو در اطلاعات ذخیره‌شده مشخص نیست. این مورد را پایان مهلت پیش‌نویس یا ناموفق بودن ارسال حساب نمی‌کنیم.'
          : 'علت لغو از اطلاعات ذخیره‌شده مشخص نیست، پس آن را پایان مهلت پیش‌نویس یا شکست ارسال اعلام نمی‌کنیم.',
        nextActor: 'NONE',
        noneKind: 'DRAFT_CLOSED',
      };
    default:
      return {
        headline: 'وضعیت درخواست نامشخص است',
        explanation: 'این مقدار وضعیت درخواست VIP شناخته‌شده نیست.',
        nextActor: 'NONE',
        noneKind: 'DRAFT_CLOSED',
      };
  }
}

function adminDispatchNarrative(
  facts: VipProgressFacts,
  flags: { messagesSettled: boolean; countsTrustworthy: boolean },
): { headline: string; explanation: string; nextActor: VipProgressNextActor; noneKind: NoneKind } {
  if (facts.status === 'SUBMITTED') {
    return {
      headline: 'ثبت شده؛ منتظر شروع رسیدگی',
      explanation: 'درخواست منتظر اقدام پلتفرم است. ثبت درخواست به‌تنهایی به معنای ارسال پیام نیست.',
      nextActor: 'PLATFORM_ADMIN',
      noneKind: 'HANDLING_SETTLED',
    };
  }
  if (facts.status === 'BALE_NOT_IMPLEMENTED') {
    return {
      headline: 'ارسال با بله در دسترس نیست',
      explanation:
        'انتخاب بله برای این درخواست پیامی نساخته و به ارائه‌دهنده وصل نشده است. رسیدگی دستی همچنان ممکن است.',
      nextActor: 'PLATFORM_ADMIN',
      noneKind: 'HANDLING_SETTLED',
    };
  }
  if (flags.messagesSettled && facts.sentCount === 0) {
    return {
      headline: 'کار باز نمانده؛ ارسالی ثبت نشده است',
      explanation:
        'برای گیرنده‌های این درخواست کار باز صف نمانده است و هیچ علامت ارسالی ثبت نشده است. وضعیت ذخیره‌شدهٔ درخواست همچنان رسیدگی دستی است. نتیجهٔ ناموفق، لغو یا رد در شمارش مانده است. این وضعیت ارسال موفق نیست.',
      nextActor: 'NONE',
      noneKind: 'HANDLING_SETTLED',
    };
  }
  if (flags.messagesSettled) {
    return {
      headline: 'رسیدگی پیام‌ها تمام شده',
      explanation:
        'برای گیرنده‌های این درخواست کار باز صف نمانده است. وضعیت ذخیره‌شدهٔ درخواست همچنان رسیدگی دستی است. علامت ارسال دستی تحویل یا جذب را ثابت نمی‌کند. نتیجهٔ ناموفق، لغو یا رد هر گیرنده در شمارش مانده است.',
      nextActor: 'NONE',
      noneKind: 'HANDLING_SETTLED',
    };
  }
  return {
    headline: 'رسیدگی دستی شروع شده',
    explanation: flags.countsTrustworthy
      ? 'رسیدگی دستی شروع شده است. کل درخواست ارسال‌شده نیست. هر گیرنده جداگانه هنوز در صف نیست، در صف یا در حال رسیدگی است، علامت ارسال دستی دارد، ناموفق است، لغو شده، یا برای همین درخواست رد شده است. علامت ارسال دستی تحویل پیام را ثابت نمی‌کند.'
      : 'رسیدگی دستی شروع شده است. کل درخواست ارسال‌شده نیست. علامت ارسال دستی تحویل پیام را ثابت نمی‌کند.',
    nextActor: 'PLATFORM_ADMIN',
    noneKind: 'HANDLING_SETTLED',
  };
}

function latestAction(facts: VipProgressFacts): { label: string; at: Date } | null {
  const candidates: Array<{ label: string; at: Date }> = [];
  if (facts.latestManualSentAt) {
    candidates.push({ label: 'آخرین علامت ارسال دستی', at: facts.latestManualSentAt });
  }
  if (facts.cancelledAt && facts.status === 'CANCELLED') {
    candidates.push({
      label: vipDraftReservationExpired(facts) ? 'بستن پیش‌نویس' : 'زمان لغو',
      at: facts.cancelledAt,
    });
  }
  if (facts.submittedAt) {
    candidates.push({ label: 'ثبت درخواست', at: facts.submittedAt });
  }
  if (facts.createdAt) {
    candidates.push({ label: 'شروع رزرو', at: facts.createdAt });
  }
  let best: { label: string; at: Date } | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.at.getTime() >= best.at.getTime()) best = candidate;
  }
  return best;
}
