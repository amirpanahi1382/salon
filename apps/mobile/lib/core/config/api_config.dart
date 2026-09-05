import 'package:flutter/foundation.dart';

/// Development API base URL.
///
/// Override with `--dart-define=API_BASE_URL=https://...`.
/// Production configuration must use HTTPS.
/// Physical devices and custom hosts should set API_BASE_URL rather than
/// relying on these development defaults.
class ApiConfig {
  const ApiConfig({required this.baseUrl});

  final String baseUrl;

  factory ApiConfig.fromEnvironment() {
    const fromDefine = String.fromEnvironment('API_BASE_URL');
    if (fromDefine.isNotEmpty) {
      return ApiConfig(baseUrl: _normalize(fromDefine));
    }
    return ApiConfig(baseUrl: _normalize(defaultDevelopmentUrl()));
  }

  static String defaultDevelopmentUrl() {
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3000';
    }
    return 'http://localhost:3000';
  }

  static String _normalize(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }
}
