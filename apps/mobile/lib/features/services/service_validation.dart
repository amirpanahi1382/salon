const serviceNameMaxLength = 80;
final _controlChars = RegExp(r'[\u0000-\u001F\u007F]');

class ServiceFieldValidation {
  static const requiredMessage = 'نام خدمت را وارد کنید.';
  static const invalidMessage = 'نام خدمت معتبر وارد کنید.';

  static String? nameError(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return requiredMessage;
    }
    if (trimmed.length > serviceNameMaxLength || _controlChars.hasMatch(value)) {
      return invalidMessage;
    }
    return null;
  }
}
