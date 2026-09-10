import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/features/outreach/outreach_message_template.dart';
import 'package:salon_mobile/shared/labels.dart';

void main() {
  test('composes the outreach template from editable placeholders', () {
    final draft = defaultOutreachDraft(
      customerFirstName: 'سارا',
      salonName: 'گلاب',
      salonPhone: '09121111111',
    ).copyWith(time: '18:00', discountThousands: '200');

    expect(draft.customerName, 'سارا');
    expect(draft.dateLabel, AppStrings.outreachTomorrow);
    expect(
      draft.composed,
      'سارا عزیز برای فردا ساعت 18:00 می‌توانیم با 200 هزار تومان تخفیف در سالن گلاب در خدمت شما باشیم!\nبرای رزرو این وقت با شماره 09121111111 تماس بگیرید!',
    );
  });

  test('does not invent a salon phone or discount', () {
    final draft = defaultOutreachDraft(
      customerFirstName: 'سارا',
      salonName: 'گلاب',
    );
    expect(draft.salonPhone, isEmpty);
    expect(draft.discountThousands, isEmpty);
    expect(draft.isComplete, isFalse);
  });
}
