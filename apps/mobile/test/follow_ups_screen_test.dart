import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/followups/follow_ups_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

class _FakeVisitIntentions extends VisitIntentionRepository {
  _FakeVisitIntentions({this.customerError, this.customers, this.vip})
    : super(
        ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()),
      );

  final Object? customerError;
  final FollowUpPage? customers;
  final FollowUpPage? vip;

  @override
  Future<FollowUpPage> customerFollowUps({String? cursor}) async {
    if (customerError != null) throw customerError!;
    return customers ??
        const FollowUpPage(items: [], hasMore: false, openCount: 0);
  }

  @override
  Future<FollowUpPage> vipFollowUps({String? cursor}) async {
    return vip ?? const FollowUpPage(items: [], hasMore: false, openCount: 0);
  }
}

void main() {
  testWidgets('follow-ups keeps customer and VIP lists separate', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(
            _FakeVisitIntentions(
              customers: FollowUpPage(
                items: [
                  FollowUpItem(
                    kind: 'VISIT_INTENTION',
                    id: 'i1',
                    customerId: 'c1',
                    customerDisplayName: 'سارا',
                    reportedBy: 'SALON_USER',
                    reportChannel: 'SALON_STAFF',
                    reportedAt: DateTime.utc(2026, 10, 1),
                    timeKnown: false,
                    timePrecision: 'UNKNOWN',
                    agreedTimePassed: false,
                    nextAction: 'RECORD_VISIT',
                  ),
                ],
                hasMore: false,
                openCount: 1,
              ),
              vip: FollowUpPage(
                items: [
                  FollowUpItem(
                    kind: 'VIP_VISIT_INTENTION',
                    id: 'v1',
                    reportedBy: 'PLATFORM_ADMIN',
                    reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
                    reportedAt: DateTime.utc(2026, 10, 2),
                    timeKnown: false,
                    timePrecision: 'UNKNOWN',
                    agreedTimePassed: false,
                    nextAction: 'SELECT_CUSTOMER_THEN_RECORD_VISIT',
                    identityDisclosure: 'WITHHELD',
                  ),
                ],
                hasMore: false,
                openCount: 1,
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: FollowUpsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.followUpsCustomersTab), findsOneWidget);
    expect(find.text(AppStrings.followUpsVipTab), findsOneWidget);
    expect(find.text('سارا'), findsOneWidget);
    expect(find.text(AppStrings.visitIntentionUnknownTime), findsOneWidget);
    expect(find.text(AppStrings.reportedBySalon), findsOneWidget);
    expect(find.text('مخاطب VIP'), findsNothing);
    expect(find.text('عدم مراجعه'), findsNothing);
    expect(find.text('مشتری جذب‌شده'), findsNothing);

    await tester.tap(find.text(AppStrings.followUpsVipTab));
    await tester.pumpAndSettle();
    expect(find.text('مخاطب VIP'), findsOneWidget);
    expect(find.text(AppStrings.vipReportedOrigin), findsOneWidget);
    expect(find.text(AppStrings.vipIdentityWithheld), findsOneWidget);
    expect(find.text('سارا'), findsNothing);
    expect(find.text(AppStrings.reportedByAdminHandling), findsOneWidget);
  });

  testWidgets('VIP follow-up shows admin-authorized contact and keeps withheld rows blank', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(
            _FakeVisitIntentions(
              vip: FollowUpPage(
                items: [
                  FollowUpItem(
                    kind: 'VIP_VISIT_INTENTION',
                    id: 'authorized',
                    reportedBy: 'PLATFORM_ADMIN',
                    reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
                    reportedAt: DateTime.utc(2026, 10, 11),
                    timeKnown: false,
                    timePrecision: 'UNKNOWN',
                    agreedTimePassed: false,
                    nextAction: 'SELECT_CUSTOMER_THEN_RECORD_VISIT',
                    identityDisclosure: 'ADMIN_AUTHORIZED',
                    disclosedDisplayName: 'نگار',
                    disclosedPhone: '09120000000',
                  ),
                  FollowUpItem(
                    kind: 'VIP_VISIT_INTENTION',
                    id: 'legacy',
                    reportedBy: 'PLATFORM_ADMIN',
                    reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
                    reportedAt: DateTime.utc(2026, 10, 10),
                    timeKnown: true,
                    timePrecision: 'INSTANT',
                    agreedInstant: DateTime.utc(2026, 10, 11, 12),
                    agreedTimePassed: false,
                    nextAction: 'SELECT_CUSTOMER_THEN_RECORD_VISIT',
                    identityDisclosure: 'WITHHELD',
                  ),
                ],
                hasMore: false,
                openCount: 2,
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: FollowUpsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.followUpsVipTab));
    await tester.pumpAndSettle();
    expect(find.text('نگار'), findsOneWidget);
    expect(find.text('09120000000'), findsOneWidget);
    expect(find.text(AppStrings.reportedByPlatformAdmin), findsOneWidget);
    expect(find.text(AppStrings.vipIdentityWithheld), findsOneWidget);
    expect(find.text(AppStrings.markVisited), findsNWidgets(2));
    expect(find.text('مشتری جذب شد'), findsNothing);
    expect(find.text('مراجعه انجام شد'), findsNothing);
  });

  testWidgets('follow-ups shows an error state without inventing rows', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(
            _FakeVisitIntentions(customerError: Exception('down')),
          ),
        ],
        child: const MaterialApp(home: FollowUpsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.followUpsCustomersEmpty), findsNothing);
    expect(find.text(AppStrings.retry), findsOneWidget);
  });
}
