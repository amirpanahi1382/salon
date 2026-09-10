import '../../shared/labels.dart';

class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
  });

  final int statusCode;
  final String code;
  final String message;

  bool get isUnauthenticated => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isConflict => statusCode == 409;
  bool get isValidation => statusCode == 400;
  bool get isTooLarge => statusCode == 413;

  String get userMessage {
    if (isUnauthenticated) {
      return AppStrings.sessionExpired;
    }
    if (isForbidden) {
      return AppStrings.permissionDenied;
    }
    if (isNotFound) {
      return AppStrings.recordNotFound;
    }
    if (isTooLarge) {
      return AppStrings.excelTooLarge;
    }
    if (code == 'MESSAGE_DAILY_LIMIT_REACHED') {
      return AppStrings.messageDailyLimit;
    }
    if (message.trim().isNotEmpty) {
      return localizeUserFacingMessage(message);
    }
    return AppStrings.genericError;
  }

  @override
  String toString() => 'ApiException($statusCode $code)';
}

class NetworkException implements Exception {
  const NetworkException([this.message = AppStrings.networkError]);

  final String message;

  @override
  String toString() => 'NetworkException';
}
