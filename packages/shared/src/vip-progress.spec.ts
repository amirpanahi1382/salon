import { deriveVipRequestProgress, type VipProgressFacts } from './vip-progress.js';

const now = new Date('2026-10-14T09:00:00.000Z');
const salonHeadline = 'درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود';

function facts(overrides: Partial<VipProgressFacts> = {}): VipProgressFacts {
  return {
    status: 'SUBMITTED',
    now,
    createdAt: new Date('2026-10-14T08:00:00.000Z'),
    reservedUntil: new Date('2026-10-14T08:30:00.000Z'),
    submittedAt: new Date('2026-10-14T08:20:00.000Z'),
    cancelledAt: null,
    requestedCount: 2,
    recipientCount: 2,
    notYetQueuedCount: 2,
    queuedCount: 0,
    inPipelineCount: 0,
    sentCount: 0,
    manualSentCount: 0,
    failedCount: 0,
    cancelledMessageCount: 0,
    durablySkippedCount: 0,
    activeStopWithoutDurableSkipCount: 0,
    latestManualSentAt: null,
    ...overrides,
  };
}

describe('VIP request progress', () => {
  it('keeps an open draft with the salon and does not call reservation a send', () => {
    const input = facts({
      status: 'AWAITING_SAMPLE_WORK',
      submittedAt: null,
      reservedUntil: new Date('2026-10-14T09:30:00.000Z'),
    });
    const salon = deriveVipRequestProgress(input, 'SALON');
    const admin = deriveVipRequestProgress(input, 'PLATFORM_ADMIN');
    expect(salon.nextActor).toBe('SALON');
    expect(salon.reservationStillValid).toBe(true);
    expect(salon.headline).toBe('در انتظار ارسال نمونه‌کارهای شما');
    expect(salon.explanation).toContain('۳۰ دقیقه');
    expect(salon.explanation).toContain('پیامی ساخته نشده');
    expect(salon.listReservationNote).toContain('نه اینکه پیامی در حال ارسال باشد');
    expect(salon.latestActionLabel).toBe('شروع رزرو');
    expect(admin.headline).toBe('پیش‌نویس باز است');
    expect(admin.nextActor).toBe('SALON');
    expect(input.status).toBe('AWAITING_SAMPLE_WORK');
  });

  it('asks the salon to start again after the reservation clock, before cancellation is stored', () => {
    const input = facts({
      status: 'AWAITING_SAMPLE_WORK',
      submittedAt: null,
      reservedUntil: new Date('2026-10-14T08:30:00.000Z'),
    });
    const salon = deriveVipRequestProgress(input, 'SALON');
    const admin = deriveVipRequestProgress(input, 'PLATFORM_ADMIN');
    expect(salon.reservationStillValid).toBe(false);
    expect(salon.nextActor).toBe('NONE');
    expect(salon.headline).toBe('دوباره تلاش کنید');
    expect(salon.explanation).toContain('مهلت ۳۰ دقیقه‌ای تکمیل این پیش‌نویس تمام شده');
    expect(salon.explanation).toContain('پیامی ارسال نشده');
    expect(salon.explanation).toContain('درخواست جدید');
    expect(salon.explanation).not.toContain('شکست ارسال');
    expect(admin.headline).toBe('مهلت رزرو این پیش‌نویس گذشته است');
    expect(admin.explanation).toContain('نه شکست ارسال');
    expect(input.status).toBe('AWAITING_SAMPLE_WORK');
  });

  it('uses one salon headline for submitted, manual, and unavailable Bale without merging stored statuses', () => {
    const submitted = facts();
    const manual = facts({
      status: 'MANUAL_QUEUED',
      notYetQueuedCount: 0,
      queuedCount: 1,
      inPipelineCount: 1,
      recipientCount: 2,
    });
    const bale = facts({ status: 'BALE_NOT_IMPLEMENTED', notYetQueuedCount: 2 });
    for (const input of [submitted, manual, bale]) {
      const salon = deriveVipRequestProgress(input, 'SALON');
      expect(salon.headline).toBe(salonHeadline);
      expect(salon.explanation).toContain('به معنای ارسال یا تحویل پیام نیست');
      expect(salon.explanation).not.toContain('بله');
      expect(salon.explanation).not.toContain('رسیدگی دستی');
    }
    expect(deriveVipRequestProgress(submitted, 'PLATFORM_ADMIN').headline).toBe('ثبت شده؛ منتظر شروع رسیدگی');
    expect(deriveVipRequestProgress(submitted, 'PLATFORM_ADMIN').explanation).toContain('به معنای ارسال پیام نیست');
    expect(deriveVipRequestProgress(submitted, 'PLATFORM_ADMIN').nextActor).toBe('PLATFORM_ADMIN');
    expect(deriveVipRequestProgress(manual, 'PLATFORM_ADMIN').headline).toBe('رسیدگی دستی شروع شده');
    expect(deriveVipRequestProgress(manual, 'PLATFORM_ADMIN').nextActor).toBe('PLATFORM_ADMIN');
    expect(deriveVipRequestProgress(bale, 'PLATFORM_ADMIN').headline).toBe('ارسال با بله در دسترس نیست');
    expect(deriveVipRequestProgress(bale, 'PLATFORM_ADMIN').explanation).toContain('رسیدگی دستی همچنان ممکن است');
    expect(submitted.status).toBe('SUBMITTED');
    expect(manual.status).toBe('MANUAL_QUEUED');
    expect(bale.status).toBe('BALE_NOT_IMPLEMENTED');
  });

  it('names open mixed outcomes without promising that every message will be sent', () => {
    const input = facts({
      status: 'MANUAL_QUEUED',
      notYetQueuedCount: 1,
      queuedCount: 1,
      inPipelineCount: 0,
      sentCount: 1,
      manualSentCount: 1,
      failedCount: 1,
      cancelledMessageCount: 0,
      durablySkippedCount: 0,
      recipientCount: 4,
      requestedCount: 30,
    });
    const salon = deriveVipRequestProgress(input, 'SALON');
    const admin = deriveVipRequestProgress(input, 'PLATFORM_ADMIN');
    expect(salon.headline).toBe('درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید');
    expect(salon.headline).not.toBe(salonHeadline);
    expect(salon.nextActor).toBe('PLATFORM_ADMIN');
    expect(salon.countLines.find((line) => line.key === 'manuallyMarkedSent')?.count).toBe(1);
    expect(salon.countLines.find((line) => line.key === 'failed')?.count).toBe(1);
    expect(salon.countLines.find((line) => line.key === 'inHandling')?.count).toBe(1);
    expect(admin.headline).toBe('رسیدگی دستی شروع شده');
    expect(input.status).toBe('MANUAL_QUEUED');
  });

  it('keeps salon counts for an open manual request and does not call a manual mark delivery', () => {
    const progress = deriveVipRequestProgress(
      facts({
        status: 'MANUAL_QUEUED',
        notYetQueuedCount: 0,
        queuedCount: 1,
        inPipelineCount: 1,
        manualSentCount: 0,
        sentCount: 0,
        recipientCount: 2,
        requestedCount: 2,
      }),
      'SALON',
    );
    expect(progress.headline).toBe(salonHeadline);
    expect(progress.nextActor).toBe('PLATFORM_ADMIN');
    expect(progress.countLines.find((line) => line.key === 'inHandling')?.count).toBe(2);
    expect(progress.countLines.find((line) => line.key === 'manuallyMarkedSent')?.label).toBe(
      'علامت‌خورده به‌عنوان ارسال دستی',
    );
    expect(progress.countLines.map((line) => line.label).join(' ')).not.toContain('تحویل');
  });

  it('counts one recipient once and keeps a settled manual request actionable for admin', () => {
    const sentAt = new Date('2026-10-14T08:40:00.000Z');
    const input = facts({
      status: 'MANUAL_QUEUED',
      requestedCount: 4,
      recipientCount: 4,
      notYetQueuedCount: 0,
      queuedCount: 0,
      inPipelineCount: 0,
      sentCount: 1,
      manualSentCount: 1,
      failedCount: 1,
      cancelledMessageCount: 1,
      durablySkippedCount: 1,
      activeStopWithoutDurableSkipCount: 1,
      latestManualSentAt: sentAt,
    });
    const salon = deriveVipRequestProgress(input, 'SALON');
    const admin = deriveVipRequestProgress(input, 'PLATFORM_ADMIN');
    expect(salon.headline).toBe('رسیدگی به این درخواست پایان یافت؛ نتیجهٔ هر گیرنده را پایین ببینید');
    expect(salon.headline).not.toBe(salonHeadline);
    expect(salon.nextActor).toBe('NONE');
    expect(salon.explanation).toContain('تحویل قطعی پیام نیست');
    expect(salon.explanation).toContain('حتی اگر توقف کلی برداشته شود');
    expect(salon.countLines.find((line) => line.key === 'durablySkipped')?.label).toBe(
      'برای این درخواست دیگر پیام نمی‌گیرد',
    );
    expect(salon.countLines.reduce((sum, line) => sum + line.count, 0)).toBe(4);
    expect(salon.activeStopNote).toContain('برای ۱ گیرنده');
    expect(salon.activeStopNote).toContain('یکی نیست');
    expect(salon.latestActionLabel).toBe('آخرین علامت ارسال دستی');
    expect(salon.latestActionAt).toBe(sentAt.toISOString());
    expect(admin.headline).toBe('رسیدگی پیام‌ها تمام شده');
    expect(admin.nextActor).toBe('NONE');
    expect(admin.explanation).toContain('تحویل یا جذب را ثابت نمی‌کند');
    expect(admin.countLines.find((line) => line.key === 'failed')?.count).toBe(1);
    expect(admin.countLines.find((line) => line.key === 'durablySkipped')?.label).toContain('رد پایدار');
    expect(input.status).toBe('MANUAL_QUEUED');
  });

  it('does not call a fully unsuccessful settled request finished delivery', () => {
    const input = facts({
      status: 'MANUAL_QUEUED',
      requestedCount: 3,
      recipientCount: 3,
      notYetQueuedCount: 0,
      queuedCount: 0,
      inPipelineCount: 0,
      sentCount: 0,
      manualSentCount: 0,
      failedCount: 1,
      cancelledMessageCount: 1,
      durablySkippedCount: 1,
    });
    const salon = deriveVipRequestProgress(input, 'SALON');
    const admin = deriveVipRequestProgress(input, 'PLATFORM_ADMIN');
    expect(salon.headline).toBe('رسیدگی پایان یافت؛ ارسالی برای این درخواست ثبت نشد');
    expect(salon.headline).not.toContain('به محض تأیید ادمین ارسال می‌شود');
    expect(salon.explanation).toContain('به معنای ارسال یا تحویل پیام نیست');
    expect(salon.countLines.map((line) => [line.key, line.count])).toEqual([
      ['notYetQueued', 0],
      ['inHandling', 0],
      ['manuallyMarkedSent', 0],
      ['failed', 1],
      ['cancelledMessage', 1],
      ['durablySkipped', 1],
    ]);
    expect(admin.headline).toBe('کار باز نمانده؛ ارسالی ثبت نشده است');
    expect(admin.headline).not.toBe('رسیدگی پیام‌ها تمام شده');
    expect(admin.explanation).toContain('ارسال موفق نیست');
    expect(admin.explanation).not.toContain('تحویل یا جذب');
    expect(input.status).toBe('MANUAL_QUEUED');
  });

  it('keeps an unclassified sent mark out of the manual label', () => {
    const progress = deriveVipRequestProgress(
      facts({
        status: 'MANUAL_QUEUED',
        notYetQueuedCount: 0,
        recipientCount: 1,
        requestedCount: 1,
        sentCount: 1,
        manualSentCount: 0,
      }),
      'SALON',
    );
    expect(progress.headline).toBe('رسیدگی به این درخواست پایان یافت؛ نتیجهٔ هر گیرنده را پایین ببینید');
    expect(progress.countLines.find((line) => line.key === 'manuallyMarkedSent')?.count).toBe(0);
    expect(progress.countLines.find((line) => line.key === 'unclassifiedSent')?.count).toBe(1);
    expect(progress.countLines.find((line) => line.key === 'unclassifiedSent')?.label).not.toContain('تحویل');
    expect(progress.countLines.reduce((sum, line) => sum + line.count, 0)).toBe(1);
  });

  it('calls a cancelled draft an expired reservation only when the stored close is a pre-submit cancellation', () => {
    const closed = new Date('2026-10-14T08:31:00.000Z');
    const expired = deriveVipRequestProgress(
      facts({
        status: 'CANCELLED',
        submittedAt: null,
        cancelledAt: closed,
        notYetQueuedCount: 2,
      }),
      'SALON',
    );
    expect(expired.headline).toBe('اتمام مهلت ارسال درخواست');
    expect(expired.explanation).toContain('پیش‌نویس');
    expect(expired.explanation).toContain('پیامی ارسال نشده');
    expect(expired.explanation).toContain('نه ناموفق بودن یک ارسال');
    expect(expired.latestActionLabel).toBe('بستن پیش‌نویس');
    expect(expired.nextActor).toBe('NONE');
    expect(deriveVipRequestProgress(
      facts({ status: 'CANCELLED', submittedAt: null, cancelledAt: closed, notYetQueuedCount: 2 }),
      'PLATFORM_ADMIN',
    ).headline).toBe('پیش‌نویس به‌خاطر پایان مهلت رزرو بسته شد');

    const unknown = deriveVipRequestProgress(
      facts({ status: 'CANCELLED', submittedAt: null, cancelledAt: null, notYetQueuedCount: 2 }),
      'SALON',
    );
    expect(unknown.headline).toBe('درخواست لغو شده است');
    expect(unknown.headline).not.toBe('اتمام مهلت ارسال درخواست');
    expect(unknown.explanation).toContain('پایان مهلت پیش‌نویس یا ناموفق بودن ارسال حساب نمی‌کنیم');

    const submittedThenCancelled = deriveVipRequestProgress(
      facts({
        status: 'CANCELLED',
        submittedAt: new Date('2026-10-14T08:20:00.000Z'),
        cancelledAt: closed,
      }),
      'SALON',
    );
    expect(submittedThenCancelled.headline).toBe('درخواست لغو شده است');
    expect(submittedThenCancelled.latestActionLabel).toBe('زمان لغو');
  });

  it('omits counts when one recipient would be explained twice', () => {
    const progress = deriveVipRequestProgress(
      facts({ recipientCount: 2, notYetQueuedCount: 2, durablySkippedCount: 1 }),
      'SALON',
    );
    expect(progress.countLines).toEqual([]);
    expect(progress.countsOmittedReason).toContain('نشان داده نمی‌شود');
  });
});
