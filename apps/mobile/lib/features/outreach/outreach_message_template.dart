import '../../shared/labels.dart';

class OutreachMessageDraft {
  const OutreachMessageDraft({
    required this.customerName,
    required this.dateLabel,
    required this.time,
    required this.discountThousands,
    required this.salonName,
    required this.salonPhone,
  });

  final String customerName;
  final String dateLabel;
  final String time;
  final String discountThousands;
  final String salonName;
  final String salonPhone;

  OutreachMessageDraft copyWith({
    String? customerName,
    String? dateLabel,
    String? time,
    String? discountThousands,
    String? salonName,
    String? salonPhone,
  }) {
    return OutreachMessageDraft(
      customerName: customerName ?? this.customerName,
      dateLabel: dateLabel ?? this.dateLabel,
      time: time ?? this.time,
      discountThousands: discountThousands ?? this.discountThousands,
      salonName: salonName ?? this.salonName,
      salonPhone: salonPhone ?? this.salonPhone,
    );
  }

  bool get isComplete =>
      customerName.trim().isNotEmpty &&
      dateLabel.trim().isNotEmpty &&
      time.trim().isNotEmpty &&
      discountThousands.trim().isNotEmpty &&
      salonName.trim().isNotEmpty &&
      salonPhone.trim().isNotEmpty;

  String get composed {
    return '${customerName.trim()} عزیز برای ${dateLabel.trim()} ساعت ${time.trim()} می‌توانیم با ${discountThousands.trim()} هزار تومان تخفیف در سالن ${salonName.trim()} در خدمت شما باشیم!\nبرای رزرو این وقت با شماره ${salonPhone.trim()} تماس بگیرید!';
  }
}

OutreachMessageDraft defaultOutreachDraft({
  required String customerFirstName,
  required String salonName,
  String? salonPhone,
}) {
  final name = customerFirstName.trim().isEmpty ? 'مشتری' : customerFirstName.trim();
  return OutreachMessageDraft(
    customerName: name,
    dateLabel: AppStrings.outreachTomorrow,
    time: '',
    discountThousands: '',
    salonName: salonName.trim(),
    salonPhone: salonPhone?.trim() ?? '',
  );
}
