import 'dart:math';

import 'package:dio/dio.dart';

import '../errors/api_exception.dart';
import '../storage/session_store.dart';

final _requestIdPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

String createRequestId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  String hex(int index) => bytes[index].toRadixString(16).padLeft(2, '0');
  return '${hex(0)}${hex(1)}${hex(2)}${hex(3)}-'
      '${hex(4)}${hex(5)}-'
      '${hex(6)}${hex(7)}-'
      '${hex(8)}${hex(9)}-'
      '${hex(10)}${hex(11)}${hex(12)}${hex(13)}${hex(14)}${hex(15)}';
}

bool isUuidV4(String value) => _requestIdPattern.hasMatch(value);

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
          final requestId = createRequestId();
          options.headers['x-request-id'] ??= requestId;
          options.headers['x-correlation-id'] ??=
              options.headers['x-request-id'] ?? requestId;
          if (options.data is FormData) {
            options.headers.remove('Content-Type');
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

  Future<List<int>> getBytes(String path) async {
    try {
      final response = await _dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes),
      );
      return response.data ?? const <int>[];
    } on DioException catch (error) {
      throw mapDioException(error);
    }
  }

  Future<dynamic> post(String path, {Object? data, Map<String, String>? headers}) {
    return _send(
      () => _dio.post<dynamic>(
        path,
        data: data,
        options: headers == null ? null : Options(headers: headers),
      ),
    );
  }

  Future<dynamic> postForm(String path, FormData data) {
    return _send(
      () => _dio.post<dynamic>(
        path,
        data: data,
        options: Options(
          sendTimeout: const Duration(seconds: 90),
          receiveTimeout: const Duration(seconds: 90),
        ),
      ),
    );
  }

  Future<dynamic> patch(String path, {Object? data}) {
    return _send(() => _dio.patch<dynamic>(path, data: data));
  }

  Future<void> delete(String path) async {
    try {
      await _dio.delete<dynamic>(path);
    } on DioException catch (error) {
      throw mapDioException(error);
    }
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
