import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/shared/labels.dart';

void main() {
  test('status labels stay user-facing Persian', () {
    expect(statusLabel('AT_RISK'), 'در آستانه از دست رفتن');
    expect(statusLabel('NEW'), 'مشتری جدید');
    expect(statusLabel('SOMETHING_FUTURE'), 'وضعیت نامشخص');
  });

  test('opportunity and signal labels have safe fallbacks', () {
    expect(opportunityLabel('REACTIVATION'), 'برگشت مشتری قدیمی');
    expect(opportunityLabel('FUTURE_TYPE'), 'فرصت');
    expect(opportunityLabel(null), AppStrings.sendMessageAction);
    expect(signalLabel('FREQUENT'), 'مراجعه منظم');
    expect(signalLabel('NEW_SIGNAL'), 'نشانه');
  });

  test('action status labels stay user-facing Persian', () {
    expect(actionStatusLabel('COMPLETED'), 'اقدام انجام شد');
    expect(actionStatusLabel('DISMISSED'), 'نادیده گرفتن');
    expect(actionStatusLabel('OPEN'), 'در حال پیگیری');
  });

  test('Bale message copy stays human-controlled', () {
    expect(AppStrings.sendBaleMessage, 'ارسال پیام در بله');
    expect(
      AppStrings.selectMultipleCustomers,
      'انتخاب چند مشتری برای ارسال پیام',
    );
    expect(AppStrings.sendMessageAction, 'ارسال پیام');
    expect(AppStrings.vipSendMessage, 'ارسال پیام vip');
    expect(AppStrings.vipAdminNav, 'ارسال پیام VIP');
    expect(AppStrings.adminQueueTitle, 'ارسال پیام عادی');
    expect(AppStrings.adminVipMessagingTitle, 'ارسال پیام VIP');
    expect(AppStrings.adminRemoveFromQueue, 'حذف از صف');
    expect(AppStrings.adminMarkRecipientSent, 'ارسال دستی شد');
    expect(AppStrings.adminCancelled, 'لغو شده');
    expect(AppStrings.sentOfTotal(24, 37), 'ارسال شده 24 از 37');
    expect(vipOutreachExecutionLabel('CANCELLED'), AppStrings.adminCancelled);
    expect(workspaceMessageStateLabel('CANCELLED'), AppStrings.adminCancelled);
    expect(AppStrings.vipOutreachFolders, 'پوشه ارسال VIP سالن‌ها');
    expect(AppStrings.vipOutreachEmptyTitle, 'هنوز درخواست VIP ثبت نشده.');
    expect(vipOutreachExecutionLabel('NOT_YET_QUEUED'), AppStrings.vipOutreachNotQueued);
    expect(vipOutreachExecutionLabel('QUEUED'), AppStrings.outreachStatusQueued);
    expect(vipOutreachExecutionLabel('IN_PIPELINE'), AppStrings.outreachStatusDispatched);
    expect(vipOutreachExecutionLabel('SENT'), AppStrings.outreachStatusSent);
    expect(vipOutreachExecutionLabel('FAILED'), AppStrings.outreachStatusFailed);
    expect(AppStrings.vipSalonRange, 'محدوده سالن');
    expect(AppStrings.vipDesiredRegion, 'محدوده موردنظر');
    expect(
      AppStrings.vipNoActiveListsInRegion,
      'در حال حاضر لیست فعالی برای این محدوده وجود ندارد.',
    );
    expect(AppStrings.vipListCardTitle('VIP-01-03'), 'VIP-01-03');
    expect(AppStrings.vipListCardTitle('لیست ونک'), 'لیست ونک');
    expect(AppStrings.vipExcelExport, 'خروجی اکسل');
    expect(AppStrings.vipSendManual, 'ارسال دستی');
    expect(AppStrings.vipSendBale, 'ارسال با بله');
    expect(AppStrings.vipRename, 'تغییر نام');
    expect(AppStrings.vipImportHelp, 'ستون شماره تلفن الزامی است. ستون نام اختیاری است.');
    expect(AppStrings.vipUnnamedContact, 'بدون نام');
    expect(AppStrings.vipAddSample, 'افزودن نمونه کار');
    expect(AppStrings.vipNeedsReview, 'نیازمند بررسی');
    expect(AppStrings.vipMaxSamples, 'حداکثر ۳ نمونه کار مجاز است.');
    expect(
      AppStrings.vipQuotaExhausted,
      contains('سهمیه این هفته'),
    );
    expect(AppStrings.vipSampleProgress(1), 'نمونه کارها: 1 از 3');
    expect(
      localizeUserFacingMessage('VIP 14-day quota would be exceeded'),
      AppStrings.vipQuotaExhausted,
    );
    expect(
      localizeUserFacingMessage('VIP rolling-window quota would be exceeded'),
      AppStrings.vipQuotaExhausted,
    );
    expect(
      localizeUserFacingMessage('At most 3 sample-work images are allowed'),
      AppStrings.vipMaxSamples,
    );
    expect(
      localizeUserFacingMessage('This VIP list is not available'),
      AppStrings.vipListUnavailable,
    );
    expect(AppStrings.createSuitableMessage, 'ایجاد پیام مناسب');
    expect(messageStatusLabel('SENT'), 'پیام با موفقیت ارسال شد.');
    expect(messageStatusLabel('QUEUED'), AppStrings.messageQueued);
    expect(messageStatusLabel('DISPATCHED'), AppStrings.outreachStatusDispatched);
    expect(outreachLifecycleLabel('QUEUED'), AppStrings.outreachStatusQueued);
    expect(outreachLifecycleLabel('DISPATCHED'), AppStrings.outreachStatusDispatched);
    expect(outreachLifecycleLabel('SENT'), AppStrings.outreachStatusSent);
    expect(outreachLifecycleLabel('FAILED'), AppStrings.outreachStatusFailed);
    expect(workspaceMessageStateLabel('QUEUED'), AppStrings.outreachStatusQueued);
    expect(workspaceMessageStateLabel('IN_PIPELINE'), AppStrings.outreachStatusDispatched);
    expect(workspaceMessageStateLabel('SENT'), AppStrings.workspaceMessageSent);
    expect(
      workspaceMessageStateLabel('SENT_WITH_RETURN_COMMITMENT'),
      AppStrings.workspaceMessageAgreed,
    );
    expect(
      workspaceMessageStateLabel('SENT_WITH_RETURN_EVIDENCE'),
      AppStrings.workspaceMessageReturned,
    );
    expect(workspaceMessageStateLabel('FAILED'), AppStrings.outreachStatusFailed);
    expect(AppStrings.workspaceMessageSent, 'ارسال شده');
    expect(AppStrings.workspaceMessageAgreed, 'ارسال شده — زمان مراجعه توافق شده');
    expect(AppStrings.workspaceMessageReturned, 'ارسال شده — مراجعه ثبت شده');
    expect(messageFailureLabel('NOT_CONFIGURED'), contains('بله'));
    expect(maskCustomerPhone('09121111111'), '0912****111');
  });

  test('owner-required dashboard and navigation copy is exact', () {
    expect(AppStrings.recoveryOutcomesTitle, 'نتیجه ارسال پیام‌ها');
    expect(AppStrings.overallPerformanceTitle, 'عملکرد کلی');
    expect(AppStrings.customers, 'مشتریان');
    expect(AppStrings.visits, 'نوبت انجام شده');
  });

  test('intelligence copy is localized without changing API payloads', () {
    expect(
      localizeIntelligenceCopy(
        'Usually returns every 35 days. Last visit was 52 days ago, which is past the expected return window.',
      ),
      contains('۵۲'),
    );
    expect(
      localizeIntelligenceCopy('Send a reactivation message.'),
      'یک پیام یادآوری بفرستید تا دوباره سر بزند.',
    );
    expect(
      localizeUserFacingMessage('email must be an email'),
      'ایمیل معتبر نیست.',
    );
  });
}
