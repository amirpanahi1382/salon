final _phonePattern = RegExp(r'^09\d{9}$');
final _controlChars = RegExp(r'[\u0000-\u001F\u007F]');
const _nameMaxLength = 80;

class CustomerFieldValidation {
  static const phoneRuleMessage =
      'شماره موبایل باید دقیقاً ۱۱ رقم باشد و با ۰۹ شروع شود.';
  static const firstNameRequiredMessage = 'نام را وارد کنید.';
  static const nameInvalidMessage = 'نام معتبر وارد کنید.';

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
