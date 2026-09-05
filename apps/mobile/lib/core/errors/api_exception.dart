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

  String get userMessage {
    if (isUnauthenticated) {
      return 'Please sign in again.';
    }
    if (isForbidden) {
      return 'You do not have permission to do that.';
    }
    if (isNotFound) {
      return 'We could not find that record.';
    }
    if (message.trim().isNotEmpty) {
      return message;
    }
    return 'Something went wrong. Please try again.';
  }

  @override
  String toString() => 'ApiException($statusCode $code)';
}

class NetworkException implements Exception {
  const NetworkException([
    this.message = 'Unable to reach the salon platform.',
  ]);

  final String message;

  @override
  String toString() => 'NetworkException';
}
