import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';

void main() {
  test('createRequestId is a UUID v4 the API will accept', () {
    final id = createRequestId();
    expect(isUuidV4(id), isTrue);
    expect(createRequestId(), isNot(id));
  });
}
