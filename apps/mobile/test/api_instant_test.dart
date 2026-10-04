import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_instant.dart';

void main() {
  test(
    'formats nonzero microseconds at API-supported millisecond precision',
    () {
      final value = DateTime.utc(2026, 10, 3, 12, 47, 42, 987, 654);

      expect(toApiInstant(value), '2026-10-03T12:47:42.987Z');
    },
  );

  test(
    'preserves the absolute instant when converting an offset timestamp',
    () {
      final value = DateTime.parse('2026-10-03T16:17:42.987654+03:30');

      expect(toApiInstant(value), '2026-10-03T12:47:42.987Z');
      expect(DateTime.parse(toApiInstant(value)).isUtc, isTrue);
    },
  );
}
