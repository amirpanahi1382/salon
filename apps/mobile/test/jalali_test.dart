import 'package:flutter_test/flutter_test.dart';
import 'package:shamsi_date/shamsi_date.dart';
import 'package:salon_mobile/shared/jalali.dart';

void main() {
  test('formats Jalali dates with Persian digits', () {
    final local = DateTime(2026, 9, 7, 14, 30);
    final jalali = jalaliFromLocal(local);
    expect(jalali.year, 1405);
    expect(jalali.month, 6);
    expect(jalali.day, 16);
    expect(formatJalaliPrettyDate(local), '۱۶ شهریور ۱۴۰۵');
    expect(formatJalaliDateTime(local), '۱۴۰۵/۰۶/۱۶ ۱۴:۳۰');
    expect(jalaliMonthNames[5], 'شهریور');
  });

  test('Jalali selection round-trips to the same local civil date and time', () {
    final original = DateTime(2026, 9, 7, 0, 15);
    final jalali = jalaliFromLocal(original);
    final combined = jalaliWithTimeToLocal(jalali, 0, 15);
    expect(combined, original);
    expect(combined.toUtc().toIso8601String(), original.toUtc().toIso8601String());
    final restored = DateTime.parse(combined.toUtc().toIso8601String()).toLocal();
    expect(jalaliFromLocal(restored).year, jalali.year);
    expect(jalaliFromLocal(restored).month, jalali.month);
    expect(jalaliFromLocal(restored).day, jalali.day);
  });

  test('UTC midnight does not shift the local Jalali day when converted via toLocal', () {
    final localMorning = DateTime(2026, 9, 7, 0, 30);
    final utc = localMorning.toUtc();
    expect(jalaliFromLocal(utc), jalaliFromLocal(localMorning));
  });

  test('month boundary Farvardin 1 1405', () {
    final local = DateTime(2026, 3, 21, 10, 0);
    final jalali = jalaliFromLocal(local);
    expect(jalali.year, 1405);
    expect(jalali.month, 1);
    expect(jalali.day, 1);
    expect(jalaliMonthNames[0], 'فروردین');
  });

  test('year boundary last day of 1404 Esfand', () {
    final local = DateTime(2026, 3, 20, 12, 0);
    final jalali = jalaliFromLocal(local);
    expect(jalali.year, 1404);
    expect(jalali.month, 12);
    expect(jalali.day, 29);
  });

  test('leap-year Esfand 30 (1403) converts to Gregorian 20 Mar 2025', () {
    final jalali = Jalali(1403, 12, 30);
    final local = jalaliWithTimeToLocal(jalali, 9, 0);
    expect(local.year, 2025);
    expect(local.month, 3);
    expect(local.day, 20);
    expect(jalaliFromLocal(local).day, 30);
    expect(jalali.monthLength, 30);
  });

  test('today uses the current local Jalali date', () {
    final now = DateTime.now();
    expect(jalaliFromLocal(now).year, Jalali.fromDateTime(now).year);
    expect(formatJalaliDate(now).contains('۱۴'), isTrue);
  });

  test('API payload remains ASCII ISO-8601, not Persian digits', () {
    final local = DateTime(2026, 9, 7, 14, 30);
    final payload = local.toUtc().toIso8601String();
    expect(payload.contains(RegExp(r'[۰-۹]')), isFalse);
    expect(payload.contains('T'), isTrue);
  });
}
