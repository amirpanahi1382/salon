import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/storage/session_store.dart';

void main() {
  test('empty stop response from Dio means no stop', () async {
    final plain = await _repository(
      body: Uint8List(0),
      contentType: 'text/html',
    ).findStop('09000000000');
    final json = await _repository(
      body: Uint8List(0),
      contentType: Headers.jsonContentType,
    ).findStop('09000000000');

    expect(plain, isNull);
    expect(json, isNull);
  });

  test('valid stop object is parsed', () async {
    final stop = await _repository(
      body: _json({
        'phoneNumber': '09000000000',
        'active': true,
        'reasonCode': 'RECIPIENT_REQUEST',
        'registeredAt': '2026-10-12T14:00:00.000Z',
        'liftedAt': null,
        'blockedRequestCount': 2,
        'skippedRecipientCount': 1,
      }),
    ).findStop('09000000000');

    expect(stop, isNotNull);
    expect(stop!.phoneNumber, '09000000000');
    expect(stop.active, isTrue);
    expect(stop.reasonCode, 'RECIPIENT_REQUEST');
    expect(stop.blockedRequestCount, 2);
    expect(stop.skippedRecipientCount, 1);
  });

  test('malformed stop response stays an error', () async {
    await expectLater(
      _repository(body: _json(<String, dynamic>{})).findStop('09000000000'),
      throwsA(isA<TypeError>()),
    );
    await expectLater(
      _repository(body: utf8.encode('[]')).findStop('09000000000'),
      throwsA(isA<TypeError>()),
    );
    await expectLater(
      _repository(body: utf8.encode('"09000000000"')).findStop('09000000000'),
      throwsA(isA<TypeError>()),
    );
  });
}

Uint8List _json(Object value) => utf8.encode(jsonEncode(value));

AdminMessageRepository _repository({
  required List<int> body,
  String contentType = Headers.jsonContentType,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'http://example.test',
      validateStatus: (status) =>
          status != null && status >= 200 && status < 300,
    ),
  );
  dio.httpClientAdapter = _FixedBodyAdapter(body, contentType);
  return AdminMessageRepository(
    ApiClient(
      baseUrl: 'http://example.test',
      sessionStore: MemorySessionStore(),
      dio: dio,
    ),
  );
}

class _FixedBodyAdapter implements HttpClientAdapter {
  _FixedBodyAdapter(this.body, this.contentType);

  final List<int> body;
  final String contentType;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromBytes(
      body,
      200,
      headers: {
        Headers.contentTypeHeader: [contentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
