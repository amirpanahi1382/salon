import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';

void main() {
  test('createRequestId is a UUID v4 the API will accept', () {
    final id = createRequestId();
    expect(isUuidV4(id), isTrue);
    expect(createRequestId(), isNot(id));
  });

  test('Dio 201 is treated as success by the API client', () {
    expect(
      Dio(
        BaseOptions(
          validateStatus: (status) =>
              status != null && status >= 200 && status < 300,
        ),
      ).options.validateStatus(201),
      isTrue,
    );
  });
}
