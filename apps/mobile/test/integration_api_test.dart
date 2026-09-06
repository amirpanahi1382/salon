import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/storage/session_store.dart';

/// Real-backend smoke flow. Run only when the API is up:
/// `flutter test test/integration_api_test.dart`
void main() {
  final enabled = Platform.environment['RUN_API_INTEGRATION'] == 'true';

  test(
    'register, customer, visit, intelligence against the live API',
    () async {
      if (!enabled) {
        return;
      }
      final store = MemorySessionStore();
      final api = ApiClient(
        baseUrl:
            Platform.environment['API_BASE_URL'] ?? 'http://localhost:3000',
        sessionStore: store,
      );
      final auth = AuthRepository(api: api, sessionStore: store);
      final customers = CustomerRepository(api);
      final visits = VisitRepository(api);
      final intelligence = IntelligenceRepository(api);

      final stamp = DateTime.now().microsecondsSinceEpoch;
      final session = await auth.register(
        salonName: 'Flutter Verify Salon',
        ownerName: 'Flutter Owner',
        email: 'flutter-$stamp@example.test',
        password: 'correct-horse-battery',
      );
      expect(session.accessToken, isNotEmpty);

      final me = await auth.me();
      expect(me.role, 'OWNER');

      final customer = await customers.create(
        firstName: 'Sara',
        lastName: 'Ahmadi',
        phoneNumber:
            '0912${stamp.toString().substring(stamp.toString().length - 7)}',
      );
      await visits.record(
        customerId: customer.id,
        visitedAt: DateTime.now().toUtc().subtract(const Duration(days: 87)),
        idempotencyKey: 'flutter-int-visit-1-$stamp',
      );
      await visits.record(
        customerId: customer.id,
        visitedAt: DateTime.now().toUtc().subtract(const Duration(days: 52)),
        idempotencyKey: 'flutter-int-visit-2-$stamp',
      );
      final intel = await intelligence.forCustomer(customer.id);
      expect(intel.status, 'AT_RISK');
      expect(intel.opportunities, isNotEmpty);

      final summary = await intelligence.summary();
      expect(summary.customers, greaterThan(0));

      await auth.logout();
      expect(await store.read(), isNull);
    },
  );
}
