import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/customers/customer_screens.dart';
import 'package:salon_mobile/features/outreach/manual_outreach_selection.dart';
import 'package:salon_mobile/features/outreach/manual_outreach_state.dart';
import 'package:salon_mobile/features/vip/salon_vip_section.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

Customer _customer({
  String id = 'c1',
  String firstName = 'Sara',
  String lastName = 'Ahmadi',
  String phone = '09121234567',
}) {
  return Customer(
    id: id,
    firstName: firstName,
    lastName: lastName,
    phoneNumber: phone,
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  );
}

class FakeCustomerRepository extends CustomerRepository {
  FakeCustomerRepository({this.items = const [], this.pageSize})
    : super(_client());

  List<Customer> items;
  Object? error;
  int? pageSize;
  int listCalls = 0;
  String? lastQuery;
  String? lastCursor;

  @override
  Future<ItemPage<Customer>> list({String? query, String? cursor}) async {
    if (error != null) {
      throw error!;
    }
    lastQuery = query;
    lastCursor = cursor;
    listCalls += 1;
    final filtered = query == null || query.isEmpty
        ? items
        : items
              .where(
                (item) =>
                    item.fullName.toLowerCase().contains(query.toLowerCase()),
              )
              .toList();
    if (pageSize == null) {
      return ItemPage(items: filtered, hasMore: false);
    }
    final start = cursor == null ? 0 : int.tryParse(cursor) ?? 0;
    final end = start + pageSize!;
    final slice = filtered.skip(start).take(pageSize!).toList();
    final hasMore = end < filtered.length;
    return ItemPage(
      items: slice,
      hasMore: hasMore,
      nextCursor: hasMore ? '$end' : null,
    );
  }

  @override
  Future<Customer> create({
    required String firstName,
    required String lastName,
    required String phoneNumber,
  }) async {
    final created = _customer(
      id: 'c-new',
      firstName: firstName,
      lastName: lastName,
      phone: phoneNumber,
    );
    items = [...items, created];
    return created;
  }
}

class FakeVipRepository extends VipRepository {
  FakeVipRepository({this.entitled = false}) : super(_client());

  final bool entitled;

  @override
  Future<VipCapability> capability() async {
    return VipCapability(entitled: entitled, remainingQuota: 100, usedQuota: 0);
  }
}

List<Customer> _manyCustomers(int count) {
  return [
    for (var i = 0; i < count; i++)
      _customer(
        id: 'c$i',
        firstName: 'C$i',
        lastName: 'L',
        phone: '0912111111${i % 10}',
      ),
  ];
}

Widget _app({
  required FakeCustomerRepository customers,
  FakeVipRepository? vip,
  GoRouter? router,
}) {
  final overrides = [
    customerRepositoryProvider.overrideWithValue(customers),
    vipRepositoryProvider.overrideWithValue(vip ?? FakeVipRepository()),
  ];
  if (router != null) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp.router(routerConfig: router),
    );
  }
  return ProviderScope(
    overrides: overrides,
    child: const MaterialApp(home: CustomersScreen()),
  );
}

void main() {
  testWidgets('default customers page shows both action cards and glass rows', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      _app(
        customers: FakeCustomerRepository(
          items: [
            _customer(),
            _customer(
              id: 'c2',
              firstName: 'Maryam',
              lastName: 'Karimi',
              phone: '09121111111',
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.customers), findsWidgets);
    expect(find.text(AppStrings.selectSalonCustomersForMessage), findsOneWidget);
    expect(find.text(AppStrings.ordinaryMessageToRegisteredCustomers), findsOneWidget);
    expect(find.text(AppStrings.vipSendMessageTitle), findsOneWidget);
    expect(find.text(AppStrings.vipAttractNewInSalonRange), findsOneWidget);
    expect(find.text(AppStrings.searchCustomers), findsOneWidget);
    expect(find.text(AppStrings.salonCustomersHeading), findsOneWidget);
    expect(find.text(AppStrings.salonCustomerCountChip(2)), findsOneWidget);
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);
    expect(find.text('09121234567'), findsOneWidget);
    expect(find.text('09121111111'), findsOneWidget);
    expect(find.byIcon(Icons.person_outline), findsNWidgets(2));
    expect(find.text(AppStrings.addCustomer), findsOneWidget);
    expect(find.byType(Checkbox), findsNothing);
    expect(find.text(AppStrings.cancelSelection), findsNothing);
    expect(find.byKey(const Key('customers-continue-outreach')), findsNothing);
  });

  testWidgets('omits salon count when more pages remain', (tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      _app(
        customers: FakeCustomerRepository(
          items: _manyCustomers(20),
          pageSize: 1,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.salonCustomersHeading), findsOneWidget);
    expect(find.text(AppStrings.salonCustomerCountChip(20)), findsNothing);
  });

  testWidgets('selection mode uses the approved ordinary-messaging title', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      _app(
        customers: FakeCustomerRepository(
          items: [
            _customer(),
            _customer(id: 'c2', firstName: 'Maryam', lastName: 'Karimi'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectSalonCustomersForMessage), findsOneWidget);
    expect(find.text(AppStrings.selectMultipleCustomers), findsNothing);
    expect(
      tester.takeException(),
      isNull,
    );
  });

  testWidgets('لغو انتخاب clears pending ids and re-enters with none selected', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final container = ProviderContainer(
      overrides: [
        customerRepositoryProvider.overrideWithValue(
          FakeCustomerRepository(
            items: [
              _customer(),
              _customer(id: 'c2', firstName: 'Maryam', lastName: 'Karimi'),
            ],
          ),
        ),
        vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectedCustomersChip(0)), findsOneWidget);
    expect(find.text(AppStrings.cancelSelection), findsOneWidget);
    expect(find.text(AppStrings.vipSendMessageTitle), findsNothing);
    expect(find.byType(Checkbox), findsNWidgets(2));
    expect(
      tester.widget<FilledButton>(
        find.byKey(const Key('customers-continue-outreach')),
      ).onPressed,
      isNull,
    );

    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectedCustomersChip(1)), findsOneWidget);
    expect(
      tester.widget<FilledButton>(
        find.byKey(const Key('customers-continue-outreach')),
      ).onPressed,
      isNotNull,
    );
    expect(
      container.read(manualOutreachSelectionProvider).isSelected('c1'),
      isTrue,
    );

    await tester.tap(find.text(AppStrings.cancelSelection));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipSendMessageTitle), findsOneWidget);
    expect(find.byType(Checkbox), findsNothing);
    expect(find.byKey(const Key('customers-continue-outreach')), findsNothing);
    expect(find.text(AppStrings.selectedCustomersChip(1)), findsNothing);
    expect(find.text(AppStrings.cancelSelection), findsNothing);
    expect(container.read(manualOutreachSelectionProvider).selecting, isFalse);
    expect(container.read(manualOutreachSelectionProvider).customers, isEmpty);
    expect(container.read(manualOutreachSelectionProvider).limitMessage, isNull);

    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectedCustomersChip(0)), findsOneWidget);
    expect(container.read(manualOutreachSelectionProvider).selectedCount, 0);
  });

  testWidgets('deselecting a card lowers the selected count', (tester) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      _app(
        customers: FakeCustomerRepository(items: [_customer()]),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectedCustomersChip(1)), findsOneWidget);
    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectedCustomersChip(0)), findsOneWidget);
  });

  testWidgets('selection limit stays at 30 unique customers', (tester) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final extra = _customer(id: 'c30', firstName: 'C30', lastName: 'L');
    final selected = _manyCustomers(ManualOutreachState.maxSelection);
    final container = ProviderContainer(
      overrides: [
        customerRepositoryProvider.overrideWithValue(
          FakeCustomerRepository(items: [extra, ...selected]),
        ),
        vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
      ],
    );
    addTearDown(container.dispose);
    final outreach = container.read(manualOutreachSelectionProvider.notifier);
    outreach.enterSelection();
    for (final customer in selected) {
      expect(outreach.toggle(customer), isTrue);
    }
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text(AppStrings.selectedCustomersChip(ManualOutreachState.maxSelection)),
      findsOneWidget,
    );
    await tester.tap(find.text('C30 L'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.selectionLimitReached), findsWidgets);
    expect(
      find.text(AppStrings.selectedCustomersChip(ManualOutreachState.maxSelection)),
      findsOneWidget,
    );
    expect(container.read(manualOutreachSelectionProvider).selectedCount, 30);
  });

  testWidgets('selection survives search reload', (tester) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final repo = FakeCustomerRepository(
      items: [
        _customer(),
        _customer(id: 'c2', firstName: 'Maryam', lastName: 'Karimi'),
      ],
    );
    await tester.pumpWidget(
      _app(customers: repo),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Maryam');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsNothing);
    expect(find.text('Maryam Karimi'), findsOneWidget);
    expect(find.text(AppStrings.selectedCustomersChip(1)), findsOneWidget);

    await tester.enterText(find.byType(TextField), '');
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text(AppStrings.selectedCustomersChip(1)), findsOneWidget);
  });

  testWidgets('customer card opens details and add-customer stays in selection', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final repo = FakeCustomerRepository(items: [_customer()]);
    final router = GoRouter(
      initialLocation: '/customers',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/customers/new',
          builder: (context, state) => Scaffold(
            body: FilledButton(
              onPressed: () {
                final created = _customer(
                  id: 'c-new',
                  firstName: 'Neda',
                  lastName: 'Hosseini',
                );
                repo.items = [...repo.items, created];
                context.pop(created);
              },
              child: const Text('fake-create'),
            ),
          ),
        ),
        GoRoute(
          path: '/customers/:id',
          builder: (context, state) =>
              Text('detail-${state.pathParameters['id']}'),
        ),
      ],
    );
    final container = ProviderContainer(
      overrides: [
        customerRepositoryProvider.overrideWithValue(repo),
        vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();
    expect(find.text('detail-c1'), findsOneWidget);

    router.go('/customers');
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.addCustomer));
    await tester.pumpAndSettle();
    await tester.tap(find.text('fake-create'));
    await tester.pumpAndSettle();
    expect(find.text('Neda Hosseini'), findsOneWidget);
    expect(container.read(manualOutreachSelectionProvider).selecting, isTrue);
    expect(
      container.read(manualOutreachSelectionProvider).isSelected('c1'),
      isTrue,
    );
  });

  testWidgets('continue action uses existing opportunities handoff', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final router = GoRouter(
      initialLocation: '/customers',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/opportunities',
          builder: (context, state) => const Text('opportunities-page'),
        ),
      ],
    );
    final container = ProviderContainer(
      overrides: [
        customerRepositoryProvider.overrideWithValue(
          FakeCustomerRepository(items: [_customer()]),
        ),
        vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.selectSalonCustomersForMessage));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi'));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.continueToSendMessageFor(1)));
    await tester.pumpAndSettle();
    expect(find.text('opportunities-page'), findsOneWidget);
    expect(container.read(manualOutreachSelectionProvider).selecting, isFalse);
    expect(container.read(manualOutreachSelectionProvider).focusOutreachTab, isTrue);
    expect(container.read(manualOutreachSelectionProvider).selectedCount, 1);
  });

  testWidgets('VIP card does not send selected customer ids', (tester) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final router = GoRouter(
      initialLocation: '/customers',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/opportunities',
          builder: (context, state) => const Text('opportunities-page'),
        ),
      ],
    );
    final container = ProviderContainer(
      overrides: [
        customerRepositoryProvider.overrideWithValue(
          FakeCustomerRepository(items: [_customer()]),
        ),
        vipRepositoryProvider.overrideWithValue(
          FakeVipRepository(entitled: true),
        ),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.vipSendMessageTitle));
    await tester.pumpAndSettle();
    await tester.tap(find.text('30'));
    await tester.pumpAndSettle();
    expect(find.text('opportunities-page'), findsOneWidget);
    expect(container.read(vipSelectedCountProvider), 30);
    expect(container.read(vipSectionOpenProvider), isTrue);
    expect(container.read(manualOutreachSelectionProvider).customers, isEmpty);
  });
}
