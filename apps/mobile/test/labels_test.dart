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
    expect(messageStatusLabel('SENT'), 'پیام با موفقیت ارسال شد.');
    expect(messageStatusLabel('QUEUED'), AppStrings.messageQueued);
    expect(messageFailureLabel('NOT_CONFIGURED'), contains('بله'));
    expect(maskCustomerPhone('09121111111'), '0912****111');
  });

  test('owner-required dashboard and navigation copy is exact', () {
    expect(AppStrings.attentionQuestion, 'توجه سالن باید کدام سمت بره؟');
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
  });
}
