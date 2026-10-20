import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/features/agreement/declared_fields.dart';

void main() {
  test('normalizes Persian full names and rejects Latin, Urdu, digits, and separators', () {
    expect(normalizeDeclaredFullName('  نرگس   رضایی '), 'نرگس رضایی');
    expect(normalizeDeclaredFullName('سید\u200cعلی'), 'سید\u200cعلی');
    expect(normalizeDeclaredFullName('علي رضا'), 'علی رضا');
    expect(normalizeDeclaredFullName('فاطمه'), 'فاطمه');
    expect(normalizeDeclaredFullName('محمدجواد'), 'محمدجواد');
    expect(normalizeDeclaredFullName('Narges'), isNull);
    expect(normalizeDeclaredFullName('نرگس 2'), isNull);
    expect(normalizeDeclaredFullName('🎉'), isNull);
    expect(normalizeDeclaredFullName('نرگس!'), isNull);
    // Urdu-specific letters must not pass a broad Arabic-script check.
    expect(normalizeDeclaredFullName('محمدے'), isNull); // ے Yeh barree
    expect(normalizeDeclaredFullName('احمدٹ'), isNull); // ٹ Tteh
    expect(normalizeDeclaredFullName('علیں'), isNull); // ں Noon ghunna
    expect(normalizeDeclaredFullName(' \u200c '), isNull);
    expect(normalizeDeclaredFullName('\u200c\u200c'), isNull);
    expect(normalizeDeclaredFullName('نرگس\u200c'), isNull);
    expect(validateDeclaredFullName('Narges').isValid, isFalse);
    expect(validateDeclaredFullName('محمدے').isValid, isFalse);
  });

  test('enforces national ID length and checksum', () {
    expect(parseIranianNationalId('0013542419').status, NationalIdStatus.ok);
    expect(parseIranianNationalId('۰۰۱۳۵۴۲۴۱۹').value, '0013542419');
    expect(parseIranianNationalId('123').status, NationalIdStatus.format);
    expect(parseIranianNationalId('0013542410').status, NationalIdStatus.checksum);
    expect(validateDeclaredNationalId('0013542410').isValid, isFalse);
  });

  test('accepts mixed Persian and English salon names', () {
    expect(normalizeDeclaredSalonName('سالن Glow Beauty'), 'سالن Glow Beauty');
    expect(normalizeDeclaredSalonName('Glow'), 'Glow');
    expect(normalizeDeclaredSalonName('🎉'), isNull);
    expect(validateDeclaredSalonName('سالن Glow').isValid, isTrue);
  });
}
