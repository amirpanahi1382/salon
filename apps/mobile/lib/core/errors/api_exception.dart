import '../../shared/labels.dart';

class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.details,
  });

  final int statusCode;
  final String code;
  final String message;
  final Map<String, dynamic>? details;

  bool get isUnauthenticated => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isConflict => statusCode == 409;
  bool get isValidation => statusCode == 400;
  bool get isTooLarge => statusCode == 413;

  int? get retryAfterSeconds {
    final value = details?['retryAfterSeconds'];
    if (value is int && value >= 0) {
      return value;
    }
    if (value is num && value >= 0) {
      return value.toInt();
    }
    return null;
  }

  String get userMessage {
    if (isUnauthenticated) {
      if (message.trim() == 'Invalid email or password' ||
          message.trim() == 'Invalid phone or password') {
        return localizeUserFacingMessage(message);
      }
      return AppStrings.sessionExpired;
    }
    if (isForbidden) {
      return AppStrings.permissionDenied;
    }
    if (code == 'SIGNUP_RESEND_COOLDOWN') {
      final seconds = retryAfterSeconds;
      return seconds == null
          ? AppStrings.signupResendWait
          : AppStrings.signupResendWaitSeconds(seconds);
    }
    if (code == 'SIGNUP_SEND_LIMIT') {
      final seconds = retryAfterSeconds;
      return seconds == null
          ? AppStrings.signupSendLimit
          : AppStrings.signupSendLimitSeconds(seconds);
    }
    if (code == 'SIGNUP_VERIFICATION_LIMIT') {
      return AppStrings.signupVerificationLimit;
    }
    if (code == 'SIGNUP_VERIFICATION_FAILED') {
      return AppStrings.signupCodeInvalid;
    }
    if (code == 'SIGNUP_CHALLENGE_EXPIRED') {
      return AppStrings.signupCodeExpired;
    }
    if (code == 'SIGNUP_CHALLENGE_SUPERSEDED') {
      return AppStrings.signupChallengeSuperseded;
    }
    if (code == 'SIGNUP_PROOF_EXPIRED') {
      return AppStrings.signupProofExpired;
    }
    if (code == 'SIGNUP_PROOF_ALREADY_ISSUED') {
      return AppStrings.signupProofAlreadyIssued;
    }
    if (code == 'SIGNUP_SEND_UNCONFIRMED') {
      return AppStrings.signupSendUnconfirmed;
    }
    if (code == 'SIGNUP_VERIFICATION_UNCONFIRMED') {
      return AppStrings.signupVerificationUnconfirmed;
    }
    if (code == 'INFRASTRUCTURE_ERROR') {
      return AppStrings.signupServiceUnavailable;
    }
    if (statusCode == 429 || code == 'RATE_LIMITED') {
      return localizeUserFacingMessage('Too Many Requests');
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
    if (code == 'GLOBAL_MESSAGE_STOP') {
      return AppStrings.globalMessageStop;
    }
    if (code == 'RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED') {
      return AppStrings.arrivalVisitReviewRequired;
    }
    if (code == 'CUSTOMER_PHONE_EXISTS') {
      return AppStrings.customerPhoneExists;
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
