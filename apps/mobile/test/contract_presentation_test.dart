import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/features/agreement/contract_presentation.dart';

void main() {
  const checkbox =
      'اینجانب با مشخصات ثبت‌شده در مادهٔ ۱، متن کامل این نسخه از قرارداد خدمات تبلیغاتی اپلیکیشن «جذب مشتری» را مطالعه کرده‌ام و مفاد آن را می‌پذیرم. می‌دانم مبلغ ۵ میلیون تومان بابت کمپینِ دارای تعهد ۵۰۰ ارسال قابل‌احتساب طبق مادهٔ ۴ است، نه تضمین مشاهدهٔ پیام، جذب مشتری، مراجعهٔ حضوری یا فروش. تعهد دارم تخفیف ثبت‌شده در سفارش را مطابق شرایط آن اعمال کنم.';
  const button = 'تأیید قرارداد و ادامه به راهنمای واریز';

  test('strips only the known CONTRACT_V1 app UI-description block', () {
    final source = [
      '# $contractV1Title',
      '',
      '## مادهٔ ۷ ـ پذیرش الکترونیکی و سوابق قرارداد',
      '',
      'صرف ثبت‌نام پذیرش نیست.',
      '',
      contractV1AppUiBlockHeading,
      '',
      '☐ $checkbox',
      '',
      '**[$button]**',
      '',
    ].join('\n');

    final stripped = stripContractV1AppUiDescriptionBlock(
      source,
      checkboxWording: checkbox,
      buttonWording: button,
    );
    expect(stripped, isNotNull);
    expect(stripped!, contains('## مادهٔ ۷'));
    expect(stripped, contains('صرف ثبت‌نام پذیرش نیست.'));
    expect(stripped, isNot(contains('متن گزینهٔ تأیید در اپلیکیشن')));
    expect(stripped, isNot(contains('☐ ')));
    expect(stripped, isNot(contains('**[$button]**')));
  });

  test('returns null when the UI heading is present but the block does not match', () {
    final source = [
      '## مادهٔ ۷',
      '',
      contractV1AppUiBlockHeading,
      '',
      '☐ wording that does not match',
      '',
      '**[$button]**',
    ].join('\n');

    expect(
      stripContractV1AppUiDescriptionBlock(
        source,
        checkboxWording: checkbox,
        buttonWording: button,
      ),
      isNull,
    );
  });

  test('leaves text unchanged when the UI heading is absent', () {
    const source = '## مادهٔ ۳\n\nمبلغ این قرارداد **۵۰٬۰۰۰٬۰۰۰ ریال** است.';
    expect(
      stripContractV1AppUiDescriptionBlock(
        source,
        checkboxWording: checkbox,
        buttonWording: button,
      ),
      source,
    );
  });

  test('strips trailing Article 1 field labels for display only', () {
    const fullNameSeg =
        '**طرف دوم ـ سفارش‌دهنده و نمایندهٔ سالن آرایشگاهی:**  \nنام و نام خانوادگی: ';
    final prepared = prepareContractPresentation(
      versionKey: contractV1VersionKey,
      source: '# $contractV1Title\n\n## مادهٔ ۱\n\n$fullNameSeg',
      checkboxWording: checkbox,
      buttonWording: button,
      stripTrailingFieldLabelFor: 'fullName',
    );
    expect(prepared, isNotNull);
    expect(prepared!.body.contains('نام و نام خانوادگی'), isFalse);
    expect(prepared.body.contains('طرف دوم'), isTrue);
    expect(stripTrailingArticle1FieldLabel('  \nکد ملی: ', 'nationalId').trim(), isEmpty);
    expect(
      stripTrailingArticle1FieldLabel('  \nنام سالن آرایشگاهی: ', 'salonName').trim(),
      isEmpty,
    );
  });
}
