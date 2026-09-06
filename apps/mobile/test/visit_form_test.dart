import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/customers/customer_screens.dart';
import 'package:salon_mobile/shared/models/models.dart';

class FakeVisitRepository extends VisitRepository {
  FakeVisitRepository()
    : super(
        ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
      );

  Object? error;
  bool recorded = false;

  @override
  Future<Visit> record({
    required String customerId,
    required DateTime visitedAt,
    required String idempotencyKey,
  }) async {
    if (error != null) {
      throw error!;
    }
    recorded = true;
    return Visit(
      id: 'v1',
      customerId: customerId,
      visitedAt: visitedAt,
      createdAt: DateTime.utc(2026, 1, 1),
    );
  }
}

void main() {
  testWidgets('record visit shows backend validation message', (tester) async {
    final visits = FakeVisitRepository()
      ..error = const ApiException(
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message:
            'visitedAt must be a completed visit time, not a future booking',
      );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [visitRepositoryProvider.overrideWith((ref) => visits)],
        child: MaterialApp.router(
          routerConfig: GoRouter(
            routes: [
              GoRoute(
                path: '/',
                builder: (_, _) => const RecordVisitScreen(customerId: 'c1'),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(FilledButton));
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(find.textContaining('completed visit time'), findsOneWidget);
  });
}
