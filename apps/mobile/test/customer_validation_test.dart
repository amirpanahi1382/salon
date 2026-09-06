import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/features/customers/customer_validation.dart';

void main() {
  group('CustomerFieldValidation.phoneError', () {
    test('accepts the canonical 11-digit 09 format', () {
      expect(CustomerFieldValidation.phoneError('09121111111'), isNull);
    });

    test('rejects empty, short, long, prefix, and spaced values', () {
      const invalid = [
        '',
        '9121111111',
        '+989121111111',
        '00989121111111',
        '0912 111 1111',
        '0912-111-1111',
        '0912111111',
        '091211111111',
        '981211111111',
        ' 09121111111',
        '09121111111 ',
      ];
      for (final phone in invalid) {
        expect(
          CustomerFieldValidation.phoneError(phone),
          CustomerFieldValidation.phoneRuleMessage,
        );
      }
    });
  });

  group('CustomerFieldValidation names', () {
    test('rejects empty and control-character names', () {
      expect(
        CustomerFieldValidation.firstNameError('  '),
        CustomerFieldValidation.firstNameRequiredMessage,
      );
      expect(
        CustomerFieldValidation.firstNameError('Sara\u0007'),
        CustomerFieldValidation.nameInvalidMessage,
      );
    });

    test('accepts Persian and Latin names', () {
      expect(CustomerFieldValidation.firstNameError('سارا'), isNull);
      expect(CustomerFieldValidation.firstNameError('Sara'), isNull);
      expect(CustomerFieldValidation.lastNameError('احمدی'), isNull);
      expect(CustomerFieldValidation.lastNameError(''), isNull);
    });
  });
}
