import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/routing/app_router.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/followups/follow_ups_screen.dart';
import 'package:salon_mobile/features/followups/follow_ups_tab.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

class _FakeVisitIntentions extends VisitIntentionRepository {
  _FakeVisitIntentions({this.customerError, this.customers, this.vip})
    : super(
        ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
      );

  final Object? customerError;
  final FollowUpPage? customers;
  FollowUpPage? vip;
  FollowUpPage? vipMore;
  int customerCalls = 0;
  int vipCalls = 0;
  final customerCursors = <String?>[];
  final vipCursors = <String?>[];

  @override
  Future<FollowUpPage> customerFollowUps({String? cursor}) async {
    customerCalls += 1;
    customerCursors.add(cursor);
    if (customerError != null) throw customerError!;
    return customers ??
        const FollowUpPage(items: [], hasMore: false, openCount: 0);
  }

  @override
  Future<FollowUpPage> vipFollowUps({String? cursor}) async {
    vipCalls += 1;
    vipCursors.add(cursor);
    if (cursor != null && vipMore != null) {
      return vipMore!;
    }
    return vip ?? const FollowUpPage(items: [], hasMore: false, openCount: 0);
  }
}

class _FakeSalon extends SalonRepository {
  _FakeSalon()
    : super(
        ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
      );

  @override
  Future<SalonProfile> current() async {
    return const SalonProfile(
      id: 's1',
      name: 'Rose Salon',
      status: 'ACTIVE',
      phone: '09120000000',
    );
  }

  @override
  Future<SalonOverallPerformance> overallPerformance() async {
    return const SalonOverallPerformance(
      customerCount: 3,
      salonCustomerSentMessageCount: 4,
      salonCustomerMessageRequestCount: 100,
      vipSentMessageCount: 1,
      vipMessageRequestCount: 30,
      monthlyRecordedRevenueIrr: '125000000.00',
      agreedReturnCount: 2,
      messageAssociatedReturnedCustomerCount: 1,
      returningSalonCustomerCount: 1,
    );
  }
}

class _SignedInAuth extends AuthController {
  @override
  AuthState build() {
    return const AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(id: 'u1', tenantId: 't1', role: 'OWNER', name: 'Leila'),
    );
  }
}

FollowUpItem _customerItem() {
  return FollowUpItem(
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
  );
}

FollowUpItem _vipItem({String id = 'v1'}) {
  return FollowUpItem(
    kind: 'VIP_VISIT_INTENTION',
    id: id,
    reportedBy: 'PLATFORM_ADMIN',
    reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
    reportedAt: DateTime.utc(2026, 10, 2),
    timeKnown: false,
    timePrecision: 'UNKNOWN',
    agreedTimePassed: false,
    nextAction: 'SELECT_CUSTOMER_THEN_RECORD_VISIT',
    identityDisclosure: 'WITHHELD',
  );
}

FollowUpPage _customerPage() {
  return FollowUpPage(items: [_customerItem()], hasMore: false, openCount: 1);
}

FollowUpPage _vipPage({bool hasMore = false, String? nextCursor}) {
  return FollowUpPage(
    items: [_vipItem()],
    hasMore: hasMore,
    openCount: 1,
    nextCursor: nextCursor,
  );
}

int _selectedTabIndex(WidgetTester tester) {
  return tester.widget<TabBar>(find.byType(TabBar)).controller!.index;
}

_FakeVisitIntentions _bothLists() {
  return _FakeVisitIntentions(customers: _customerPage(), vip: _vipPage());
}

Future<GoRouter> _pumpRealRouter(
  WidgetTester tester, {
  required _FakeVisitIntentions intentions,
}) async {
  tester.view.physicalSize = const Size(800, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final container = ProviderContainer(
    overrides: [
      sessionStoreProvider.overrideWithValue(MemorySessionStore()),
      salonRepositoryProvider.overrideWithValue(_FakeSalon()),
      visitIntentionRepositoryProvider.overrideWithValue(intentions),
      authControllerProvider.overrideWith(_SignedInAuth.new),
    ],
  );
  addTearDown(container.dispose);
  final router = container.read(routerProvider);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        routerConfig: router,
        builder: (context, child) => Directionality(
          textDirection: TextDirection.rtl,
          child: child ?? const SizedBox.shrink(),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

void main() {
  test('FollowUpsTab parses known, missing, and invalid query values', () {
    expect(FollowUpsTab.parse(null), FollowUpsTab.customers);
    expect(FollowUpsTab.parse(''), FollowUpsTab.customers);
    expect(
      FollowUpsTab.parse(FollowUpsTab.customersQuery),
      FollowUpsTab.customers,
    );
    expect(FollowUpsTab.parse(FollowUpsTab.vipQuery), FollowUpsTab.vip);
    expect(FollowUpsTab.parse('VIP'), FollowUpsTab.customers);
    expect(FollowUpsTab.parse('unknown'), FollowUpsTab.customers);
    expect(FollowUpsTab.customers.route, '/follow-ups?tab=customers');
    expect(FollowUpsTab.vip.route, '/follow-ups?tab=vip');
    expect(FollowUpsTab.defaultRoute, '/follow-ups');
  });

  testWidgets('follow-ups keeps customer and VIP lists separate', (
    tester,
  ) async {
    final intentions = _bothLists();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(intentions),
        ],
        child: const MaterialApp(home: FollowUpsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.followUpsCustomersTab), findsOneWidget);
    expect(find.text(AppStrings.followUpsVipTab), findsOneWidget);
    expect(find.text('سارا').hitTestable(), findsOneWidget);
    expect(
      find.text(AppStrings.visitIntentionUnknownTime).hitTestable(),
      findsOneWidget,
    );
    expect(find.text(AppStrings.reportedBySalon).hitTestable(), findsOneWidget);
    expect(find.text('مخاطب VIP').hitTestable(), findsNothing);
    expect(find.text('عدم مراجعه'), findsNothing);
    expect(find.text('مشتری جذب‌شده'), findsNothing);
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 0);

    await tester.tap(find.text(AppStrings.followUpsVipTab));
    await tester.pumpAndSettle();
    expect(find.text('مخاطب VIP').hitTestable(), findsOneWidget);
    expect(
      find.text(AppStrings.vipReportedOrigin).hitTestable(),
      findsOneWidget,
    );
    expect(
      find.text(AppStrings.vipIdentityWithheld).hitTestable(),
      findsOneWidget,
    );
    expect(find.text('سارا').hitTestable(), findsNothing);
    expect(
      find.text(AppStrings.reportedByAdminHandling).hitTestable(),
      findsOneWidget,
    );
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 1);

    await tester.tap(find.text(AppStrings.followUpsCustomersTab));
    await tester.pumpAndSettle();
    expect(find.text('سارا').hitTestable(), findsOneWidget);
    expect(find.text('مخاطب VIP').hitTestable(), findsNothing);
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 1);
  });

  testWidgets(
    'VIP follow-up shows admin-authorized contact and keeps withheld rows blank',
    (tester) async {
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
    },
  );

  testWidgets('follow-ups shows an error state without inventing rows', (
    tester,
  ) async {
    final intentions = _FakeVisitIntentions(customerError: Exception('down'));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(intentions),
        ],
        child: const MaterialApp(home: FollowUpsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.followUpsCustomersEmpty), findsNothing);
    expect(find.text(AppStrings.retry), findsOneWidget);
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 0);
  });

  testWidgets(
    'dashboard salon message row opens previous-customers follow-ups',
    (tester) async {
      final intentions = _bothLists();
      await _pumpRealRouter(tester, intentions: intentions);
      await tester.scrollUntilVisible(
        find.byKey(const Key('dashboard-salon-message-results')),
        300,
      );
      await tester.tap(
        find.byKey(const Key('dashboard-salon-message-results')),
      );
      await tester.pumpAndSettle();

      expect(find.text(AppStrings.followUpsTitle), findsOneWidget);
      expect(_selectedTabIndex(tester), FollowUpsTab.customers.index);
      expect(find.text('سارا').hitTestable(), findsOneWidget);
      expect(find.text('مخاطب VIP').hitTestable(), findsNothing);
      expect(intentions.customerCalls, 1);
      expect(intentions.vipCalls, 0);
      expect(intentions.customerCursors, [null]);

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text(AppStrings.dashboardHeroTitle), findsOneWidget);
      expect(find.text(AppStrings.followUpsTitle), findsNothing);
    },
  );

  testWidgets('dashboard VIP message row opens VIP follow-ups immediately', (
    tester,
  ) async {
    final intentions = _bothLists();
    await _pumpRealRouter(tester, intentions: intentions);
    await tester.scrollUntilVisible(
      find.byKey(const Key('dashboard-vip-message-results')),
      300,
    );
    await tester.tap(find.byKey(const Key('dashboard-vip-message-results')));
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.followUpsTitle), findsOneWidget);
    expect(_selectedTabIndex(tester), FollowUpsTab.vip.index);
    expect(find.text('مخاطب VIP').hitTestable(), findsOneWidget);
    expect(
      find.text(AppStrings.vipIdentityWithheld).hitTestable(),
      findsOneWidget,
    );
    expect(find.text('سارا').hitTestable(), findsNothing);
    expect(intentions.customerCalls, 0);
    expect(intentions.vipCalls, 1);
    expect(intentions.vipCursors, [null]);
  });

  testWidgets('first-action follow-ups keeps the default customers tab', (
    tester,
  ) async {
    final intentions = _bothLists();
    await _pumpRealRouter(tester, intentions: intentions);
    await tester.scrollUntilVisible(
      find.text(AppStrings.dashboardFirstActionButton),
      300,
    );
    await tester.tap(find.text(AppStrings.dashboardFirstActionButton));
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.followUpsTitle), findsOneWidget);
    expect(_selectedTabIndex(tester), FollowUpsTab.customers.index);
    expect(find.text('سارا').hitTestable(), findsOneWidget);
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 0);
  });

  testWidgets('direct /follow-ups entry opens the customers tab', (
    tester,
  ) async {
    final intentions = _bothLists();
    final router = await _pumpRealRouter(tester, intentions: intentions);
    router.go(FollowUpsTab.defaultRoute);
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.followUpsTitle), findsOneWidget);
    expect(_selectedTabIndex(tester), FollowUpsTab.customers.index);
    expect(find.text('سارا').hitTestable(), findsOneWidget);
    expect(find.text('مخاطب VIP').hitTestable(), findsNothing);
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 0);
  });

  testWidgets('invalid follow-ups tab query falls back to customers', (
    tester,
  ) async {
    final intentions = _bothLists();
    final router = await _pumpRealRouter(tester, intentions: intentions);
    router.go('${FollowUpsTab.path}?tab=unknown');
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.followUpsTitle), findsOneWidget);
    expect(_selectedTabIndex(tester), FollowUpsTab.customers.index);
    expect(find.text('سارا').hitTestable(), findsOneWidget);
    expect(find.text('مخاطب VIP').hitTestable(), findsNothing);
    expect(intentions.customerCalls, 1);
    expect(intentions.vipCalls, 0);
  });

  testWidgets('VIP follow-ups paginates without fetching the customers list', (
    tester,
  ) async {
    final intentions =
        _FakeVisitIntentions(
            customers: _customerPage(),
            vip: _vipPage(hasMore: true, nextCursor: 'vip-2'),
          )
          ..vipMore = FollowUpPage(
            items: [_vipItem(id: 'v2')],
            hasMore: false,
            openCount: 2,
          );
    final router = await _pumpRealRouter(tester, intentions: intentions);
    router.go(FollowUpsTab.vip.route);
    await tester.pumpAndSettle();

    expect(_selectedTabIndex(tester), FollowUpsTab.vip.index);
    expect(find.text('مخاطب VIP').hitTestable(), findsOneWidget);
    expect(find.text(AppStrings.loadMore), findsOneWidget);
    await tester.tap(find.text(AppStrings.loadMore));
    await tester.pumpAndSettle();
    expect(intentions.customerCalls, 0);
    expect(intentions.vipCalls, 2);
    expect(intentions.vipCursors, [null, 'vip-2']);
    expect(find.text(AppStrings.markVisited), findsNWidgets(2));
  });
}
