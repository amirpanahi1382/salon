import 'package:shamsi_date/shamsi_date.dart';

const persianDigitMap = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

const jalaliMonthNames = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const jalaliWeekdayShort = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

String toPersianDigits(String value) {
  final buffer = StringBuffer();
  for (final code in value.codeUnits) {
    if (code >= 48 && code <= 57) {
      buffer.write(persianDigitMap[code - 48]);
    } else {
      buffer.writeCharCode(code);
    }
  }
  return buffer.toString();
}

String _two(int value) => value.toString().padLeft(2, '0');

DateTime asLocalDateTime(DateTime value) =>
    value.isUtc ? value.toLocal() : value;

Jalali jalaliFromLocal(DateTime value) =>
    Jalali.fromDateTime(asLocalDateTime(value));

/// Combines a Jalali civil date with a clock time in the device local zone.
DateTime jalaliWithTimeToLocal(Jalali date, int hour, int minute) {
  final gregorian = date.toGregorian();
  return DateTime(
    gregorian.year,
    gregorian.month,
    gregorian.day,
    hour,
    minute,
  );
}

DateTime replaceLocalDateKeepingTime(DateTime current, Jalali date) {
  final local = asLocalDateTime(current);
  return jalaliWithTimeToLocal(date, local.hour, local.minute);
}

String formatJalaliDate(DateTime value) {
  final jalali = jalaliFromLocal(value);
  return toPersianDigits(
    '${jalali.year}/${_two(jalali.month)}/${_two(jalali.day)}',
  );
}

String formatJalaliDateTime(DateTime value) {
  final local = asLocalDateTime(value);
  return '${formatJalaliDate(local)} ${toPersianDigits('${_two(local.hour)}:${_two(local.minute)}')}';
}

String formatJalaliPrettyDate(DateTime value) {
  final jalali = jalaliFromLocal(value);
  return '${toPersianDigits(jalali.day.toString())} ${jalaliMonthNames[jalali.month - 1]} ${toPersianDigits(jalali.year.toString())}';
}

String jalaliMonthTitle(Jalali month) {
  return '${jalaliMonthNames[month.month - 1]} ${toPersianDigits(month.year.toString())}';
}
