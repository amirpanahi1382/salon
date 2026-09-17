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

/// Display-only Asia/Tehran wall clock. Iran uses UTC+03:30 without DST.
DateTime tehranWallClock(DateTime instant) =>
    instant.toUtc().add(const Duration(hours: 3, minutes: 30));

Jalali jalaliFromTehranInstant(DateTime instant) {
  final wall = tehranWallClock(instant);
  return Gregorian(wall.year, wall.month, wall.day).toJalali();
}

String formatJalaliPrettyDateTehran(DateTime instant) {
  final jalali = jalaliFromTehranInstant(instant);
  return '${toPersianDigits(jalali.day.toString())} ${jalaliMonthNames[jalali.month - 1]} ${toPersianDigits(jalali.year.toString())}';
}

String formatOwnerBusinessWeekLabel(DateTime start, DateTime endExclusive) {
  final last = endExclusive.toUtc().subtract(const Duration(milliseconds: 1));
  return '${formatJalaliPrettyDateTehran(start)} — ${formatJalaliPrettyDateTehran(last)}';
}

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
