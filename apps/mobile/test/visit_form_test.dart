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
import 'package:salon_mobile/shared/jalali.dart';
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
  DateTime? lastVisitedAt;

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
    lastVisitedAt = visitedAt;
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
    expect(
      find.textContaining('تاریخ باید برای مراجعه انجام‌شده باشد'),
      findsOneWidget,
    );
  });

  testWidgets('record visit shows Jalali date and Persian month names', (tester) async {
    final visits = FakeVisitRepository();
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
    expect(find.text('تاریخ مراجعه'), findsOneWidget);
    expect(find.text('ساعت'), findsOneWidget);
    expect(find.text(formatJalaliPrettyDate(DateTime.now())), findsOneWidget);
    await tester.tap(find.byKey(const Key('visit-date-tile')));
    await tester.pumpAndSettle();
    expect(find.text(jalaliMonthTitle(jalaliFromLocal(DateTime.now()))), findsWidgets);
    expect(find.text('ش'), findsOneWidget);
    await tester.tap(find.text('تأیید'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(FilledButton));
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(visits.recorded, isTrue);
    expect(visits.lastVisitedAt, isNotNull);
    expect(jalaliFromLocal(visits.lastVisitedAt!).year, jalaliFromLocal(DateTime.now()).year);
  });
}
