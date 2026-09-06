final _phonePattern = RegExp(r'^09\d{9}$');
final _controlChars = RegExp(r'[\u0000-\u001F\u007F]');
const _nameMaxLength = 80;

class CustomerFieldValidation {
  static const phoneRuleMessage =
      'Phone number must be exactly 11 digits and start with 09.';
  static const firstNameRequiredMessage = 'First name is required.';
  static const nameInvalidMessage = 'Enter a valid name.';

  static bool isValidPhone(String value) => _phonePattern.hasMatch(value);

  static String? phoneError(String value) {
    if (!isValidPhone(value)) {
      return phoneRuleMessage;
    }
    return null;
  }

  static String? firstNameError(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return firstNameRequiredMessage;
    }
    if (trimmed.length > _nameMaxLength || _controlChars.hasMatch(value)) {
      return nameInvalidMessage;
    }
    return null;
  }

  static String? lastNameError(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return null;
    }
    if (trimmed.length > _nameMaxLength || _controlChars.hasMatch(value)) {
      return nameInvalidMessage;
    }
    return null;
  }
}
