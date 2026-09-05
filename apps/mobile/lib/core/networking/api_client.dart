import 'package:dio/dio.dart';

import '../errors/api_exception.dart';
import '../storage/session_store.dart';

class ApiClient {
  ApiClient({required String baseUrl, required this.sessionStore, Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: baseUrl,
              connectTimeout: const Duration(seconds: 12),
              receiveTimeout: const Duration(seconds: 20),
              headers: const {'Content-Type': 'application/json'},
            ),
          ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final session = await sessionStore.read();
          final token = session?.accessToken;
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final SessionStore sessionStore;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) {
    return _send(() => _dio.get<dynamic>(path, queryParameters: query));
  }

  Future<dynamic> post(String path, {Object? data}) {
    return _send(() => _dio.post<dynamic>(path, data: data));
  }

  Future<dynamic> patch(String path, {Object? data}) {
    return _send(() => _dio.patch<dynamic>(path, data: data));
  }

  Future<dynamic> _send(Future<Response<dynamic>> Function() request) async {
    try {
      final response = await request();
      return response.data;
    } on DioException catch (error) {
      throw mapDioException(error);
    }
  }
}

Exception mapDioException(DioException error) {
  if (error.type == DioExceptionType.connectionError ||
      error.type == DioExceptionType.connectionTimeout ||
      error.type == DioExceptionType.receiveTimeout ||
      error.type == DioExceptionType.sendTimeout ||
      error.type == DioExceptionType.unknown && error.response == null) {
    return const NetworkException();
  }

  final data = error.response?.data;
  if (data is Map) {
    return ApiException(
      statusCode: error.response?.statusCode ?? 500,
      code: data['error']?.toString() ?? 'HTTP_ERROR',
      message: stringifyApiMessage(data['message']),
    );
  }

  return ApiException(
    statusCode: error.response?.statusCode ?? 500,
    code: 'HTTP_ERROR',
    message: 'Something went wrong. Please try again.',
  );
}

String stringifyApiMessage(Object? message) {
  if (message is String && message.trim().isNotEmpty) {
    return message;
  }
  if (message is List) {
    final parts = message.whereType<String>().where(
      (item) => item.trim().isNotEmpty,
    );
    if (parts.isNotEmpty) {
      return parts.join('\n');
    }
  }
  return 'Something went wrong. Please try again.';
}
