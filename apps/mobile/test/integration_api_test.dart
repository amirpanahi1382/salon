import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The old live smoke registered a salon by email. That route is closed.
/// The phone signup journey is covered by the API test on a disposable database.
void main() {
  final enabled = Platform.environment['RUN_API_INTEGRATION'] == 'true';

  test('email registration smoke stays closed', () {
    if (!enabled) {
      return;
    }
    markTestSkipped(
      'Email registration is closed. The phone signup journey is covered by the API test.',
    );
  });
}
