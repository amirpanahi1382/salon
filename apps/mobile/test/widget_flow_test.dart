import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/auth/auth_screens.dart';
import 'package:salon_mobile/features/customers/customer_screens.dart';
import 'package:salon_mobile/features/dashboard/dashboard_screen.dart';
import 'package:salon_mobile/features/opportunities/opportunities_screen.dart';
import 'package:salon_mobile/features/shell/app_shell.dart';
import 'package:salon_mobile/features/visits/visits_screen.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

class FakeAuthRepository extends AuthRepository {
  FakeAuthRepository()
    : super(api: _client(), sessionStore: MemorySessionStore());

  AuthSession? nextSession;
  Object? nextError;

  @override
  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    if (nextError != null) {
      throw nextError!;
    }
    return nextSession!;
  }

  @override
  Future<void> logout() async {}
}

class FakeIntelligenceRepository extends IntelligenceRepository {
  FakeIntelligenceRepository({
    this.summaryData,
    this.opportunitiesData = const [],
    this.customerIntelligence,
  }) : super(_client());

  IntelligenceSummary? summaryData;
  List<Opportunity> opportunitiesData;
  CustomerIntelligence? customerIntelligence;
  Object? error;

  @override
  Future<IntelligenceSummary> summary() async {
    if (error != null) {
      throw error!;
    }
    return summaryData!;
  }

  @override
  Future<ItemPage<Opportunity>> opportunities({
    String? type,
    String? cursor,
  }) async {
    if (error != null) {
      throw error!;
    }
    final filtered = type == null
        ? opportunitiesData
        : opportunitiesData.where((item) => item.type == type).toList();
    return ItemPage(items: filtered, hasMore: false);
  }

  @override
  Future<CustomerIntelligence> forCustomer(String customerId) async {
    if (error != null) {
      throw error!;
    }
    return customerIntelligence!;
  }
}

class FakeSalonRepository extends SalonRepository {
  FakeSalonRepository() : super(_client());

  @override
  Future<SalonProfile> current() async {
    return const SalonProfile(id: 's1', name: 'Rose Salon', status: 'ACTIVE');
  }
}

class FakeCustomerRepository extends CustomerRepository {
  FakeCustomerRepository({this.items = const []}) : super(_client());

  List<Customer> items;
  Object? error;

  @override
  Future<ItemPage<Customer>> list({String? query, String? cursor}) async {
    if (error != null) {
      throw error!;
    }
    final filtered = query == null || query.isEmpty
        ? items
        : items
              .where(
                (item) =>
                    item.fullName.toLowerCase().contains(query.toLowerCase()),
              )
              .toList();
    return ItemPage(items: filtered, hasMore: false);
  }

  @override
  Future<Customer> getById(String id) async {
    if (error != null) {
      throw error!;
    }
    return items.firstWhere((item) => item.id == id);
  }

  @override
  Future<void> delete(String id) async {
    if (error != null) {
      throw error!;
    }
    items = items.where((item) => item.id != id).toList();
  }

  @override
  Future<Customer> update({
    required String id,
    String? firstName,
    String? lastName,
    String? phoneNumber,
  }) async {
    if (error != null) {
      throw error!;
    }
    return getById(id);
  }

  @override
  Future<Customer> create({
    required String firstName,
    required String lastName,
    required String phoneNumber,
  }) async {
    if (error != null) {
      throw error!;
    }
    final customer = Customer(
      id: 'new-${items.length}',
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      createdAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
    );
    items = [...items, customer];
    return customer;
  }

  @override
  Future<CustomerImportResult> importFromExcel({
    required List<int> bytes,
    required String filename,
  }) async {
    if (error != null) {
      throw error!;
    }
    return const CustomerImportResult(
      totalRows: 1,
      imported: 1,
      skipped: 0,
      failed: 0,
      results: [CustomerImportRowResult(row: 2, status: 'IMPORTED')],
    );
  }
}

class FakeServiceRepository extends ServiceRepository {
  FakeServiceRepository({this.items = const []}) : super(_client());

  List<SalonService> items;
  Object? error;

  @override
  Future<ItemPage<SalonService>> list() async {
    if (error != null) {
      throw error!;
    }
    return ItemPage(items: items, hasMore: false);
  }
}

class FakeTransactionRepository extends TransactionRepository {
  FakeTransactionRepository() : super(_client());

  String? lastServiceId;
  String? lastAmount;

  @override
  Future<LedgerTransaction> create({
    required String customerId,
    required String amount,
    required String serviceId,
    required String unitPrice,
    required int quantity,
    required String idempotencyKey,
    String? visitId,
  }) async {
    lastServiceId = serviceId;
    lastAmount = amount;
    return LedgerTransaction(
      id: 'tx1',
      amount: amount,
      currency: 'IRR',
      status: 'COMPLETED',
      occurredAt: DateTime.utc(2026, 1, 1),
    );
  }
}

class FakeVisitListRepository extends VisitRepository {
  FakeVisitListRepository({this.items = const []}) : super(_client());

  List<Visit> items;
  Object? error;

  @override
  Future<ItemPage<Visit>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    if (error != null) {
      throw error!;
    }
    return ItemPage(
      items: items.where((item) => item.customerId == customerId).toList(),
      hasMore: false,
    );
  }

  @override
  Future<List<Visit>> list({String? customerId, DateTime? day}) async {
    if (error != null) {
      throw error!;
    }
    var result = items;
    if (customerId != null) {
      result = result.where((item) => item.customerId == customerId).toList();
    }
    if (day != null) {
      final start = DateTime(day.year, day.month, day.day);
      final end = start.add(const Duration(days: 1));
      result = result.where((item) {
        final local = item.visitedAt.toLocal();
        return !local.isBefore(start) && local.isBefore(end);
      }).toList();
    }
    final sorted = [...result]
      ..sort((a, b) => b.visitedAt.compareTo(a.visitedAt));
    return sorted;
  }

  @override
  Future<void> delete(String id) async {
    if (error != null) {
      throw error!;
    }
    items = items.where((item) => item.id != id).toList();
  }
}

Customer _customer() {
  return Customer(
    id: 'c1',
    firstName: 'Sara',
    lastName: 'Ahmadi',
    phoneNumber: '09121234567',
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  );
}

Opportunity _opportunity() {
  return const Opportunity(
    type: 'REACTIVATION',
    customerId: 'c1',
    firstName: 'Sara',
    lastName: 'Ahmadi',
    status: 'AT_RISK',
    reason: 'Usually returns every 35 days. Last visit was 52 days ago.',
    recommendedAction: 'Send a reactivation message.',
  );
}

IntelligenceSummary _summary() {
  return const IntelligenceSummary(
    customers: 5,
    newCustomers: 1,
    active: 1,
    returning: 1,
    atRisk: 1,
    inactive: 1,
    reactivationOpportunities: 1,
    customerReturnOpportunities: 0,
    frequent: 0,
  );
}

CustomerIntelligence _intelligence() {
  return CustomerIntelligence(
    customerId: 'c1',
    firstName: 'Sara',
    lastName: 'Ahmadi',
    status: 'AT_RISK',
    explanation: 'Usually returns every 35 days. Last visit was 52 days ago.',
    behavior: const BehaviorMetrics(
      visitCount: 2,
      expectedReturnIntervalDays: 35,
      daysSinceLastVisit: 52,
      averageReturnIntervalDays: 35,
    ),
    signals: const ['OVERDUE'],
    opportunities: [_opportunity()],
    revenue: const CustomerRevenue(
      totalRevenue: '0.00',
      transactionCount: 0,
      currency: 'IRR',
    ),
  );
}

void main() {
  testWidgets('login validates empty fields', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: LoginScreen())),
    );
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    expect(find.text('Enter email and password.'), findsOneWidget);
  });

  testWidgets('login shows authentication error', (tester) async {
    final auth = FakeAuthRepository()
      ..nextError = const ApiException(
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWithValue(auth)],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );
    await tester.enterText(find.byType(TextField).first, 'a@b.com');
    await tester.enterText(find.byType(TextField).last, 'password1');
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    expect(find.text('Please sign in again.'), findsOneWidget);
  });

  testWidgets('dashboard renders summary and opportunities', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionStoreProvider.overrideWithValue(MemorySessionStore()),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              summaryData: _summary(),
              opportunitiesData: [_opportunity()],
            ),
          ),
          salonRepositoryProvider.overrideWith((ref) => FakeSalonRepository()),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: DashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Rose Salon'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.textContaining('52 days'), findsOneWidget);
    expect(find.textContaining('Send a reactivation message'), findsOneWidget);
  });

  testWidgets('dashboard empty state', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(summaryData: _summary()),
          ),
          salonRepositoryProvider.overrideWith((ref) => FakeSalonRepository()),
        ],
        child: const MaterialApp(home: DashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text("You're all caught up."), findsOneWidget);
  });

  testWidgets('customer list empty and list states', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(),
          ),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No customers yet.'), findsOneWidget);
    expect(find.text('Import from Excel'), findsWidgets);
  });

  testWidgets('customer list renders names', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
  });

  testWidgets('customer list error state', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository()..error = const NetworkException(),
          ),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Unable to reach the salon platform.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('opportunities render reason and action', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.textContaining('52 days'), findsOneWidget);
  });

  testWidgets('customer detail renders status reason action and visits', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWith(
            (ref) => FakeCustomerRepository(items: [_customer()]),
          ),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(
              items: [
                Visit(
                  id: 'v1',
                  customerId: 'c1',
                  visitedAt: DateTime.utc(2026, 7, 6),
                  createdAt: DateTime.utc(2026, 7, 6),
                ),
              ],
            ),
          ),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('At risk'), findsWidgets);
    expect(find.textContaining('52 days'), findsWidgets);
    expect(find.textContaining('Send a reactivation message'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('Completed visit'), findsOneWidget);
  });

  testWidgets('customer detail 404', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWith(
            (ref) => FakeCustomerRepository()
              ..error = const ApiException(
                statusCode: 404,
                code: 'NOT_FOUND',
                message: 'missing',
              ),
          ),
        ],
        child: const MaterialApp(
          home: CustomerDetailScreen(customerId: 'missing'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('We could not find that record.'), findsOneWidget);
  });

  testWidgets('customer edit shows permission error on 403', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWith(
            (ref) => FakeCustomerRepository(items: [_customer()])
              ..error = const ApiException(
                statusCode: 403,
                code: 'FORBIDDEN',
                message: 'nope',
              ),
          ),
        ],
        child: MaterialApp(home: CustomerFormScreen(customer: _customer())),
      ),
    );
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.text('You do not have permission to do that.'), findsOneWidget);
  });

  testWidgets('customer create rejects invalid phone before submit', (
    tester,
  ) async {
    final repo = FakeCustomerRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [customerRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: CustomerFormScreen()),
      ),
    );
    await tester.enterText(find.byType(TextField).at(0), 'Sara');
    await tester.enterText(find.byType(TextField).at(1), 'Ahmadi');
    await tester.enterText(find.byType(TextField).at(2), '+989121111111');
    await tester.tap(find.text('Save'));
    await tester.pump();
    expect(
      find.text('Phone number must be exactly 11 digits and start with 09.'),
      findsWidgets,
    );
    expect(repo.items, isEmpty);
  });

  testWidgets('customer create shows a way back and refreshes the list', (
    tester,
  ) async {
    final repo = FakeCustomerRepository();
    final router = GoRouter(
      initialLocation: '/customers',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/customers/new',
          builder: (context, state) => const CustomerFormScreen(),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [customerRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No customers yet.'), findsOneWidget);

    await tester.tap(find.text('Add customer').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'سارا');
    await tester.enterText(find.byType(TextField).at(1), 'احمدی');
    await tester.enterText(find.byType(TextField).at(2), '09121111111');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.text('Customer created successfully'), findsOneWidget);
    expect(find.text('Back to Customers'), findsOneWidget);

    await tester.tap(find.text('Back to Customers'));
    await tester.pumpAndSettle();
    expect(find.text('سارا احمدی'), findsOneWidget);
  });

  testWidgets('bottom navigation includes Visits', (tester) async {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        ShellRoute(
          builder: (context, state, child) => AppShell(child: child),
          routes: [
            GoRoute(
              path: '/',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/customers',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/visits',
              builder: (context, state) => const Text('Visits page'),
            ),
            GoRoute(
              path: '/opportunities',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/profile',
              builder: (context, state) => const SizedBox.shrink(),
            ),
          ],
        ),
      ],
    );
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    expect(find.text('Visits'), findsOneWidget);
    await tester.tap(find.text('Visits'));
    await tester.pumpAndSettle();
    expect(find.text('Visits page'), findsOneWidget);
  });

  testWidgets('visits screen shows today empty state and filters', (
    tester,
  ) async {
    final now = DateTime.now();
    final todayVisit = Visit(
      id: 'v-today',
      customerId: 'c1',
      firstName: 'Sara',
      lastName: 'Ahmadi',
      visitedAt: DateTime(now.year, now.month, now.day, 14, 30),
      createdAt: DateTime.utc(2026, 1, 1),
    );
    final yesterdayVisit = Visit(
      id: 'v-yday',
      customerId: 'c2',
      firstName: 'Maryam',
      lastName: 'Karimi',
      visitedAt: DateTime(
        now.year,
        now.month,
        now.day,
        11,
      ).subtract(const Duration(days: 1)),
      createdAt: DateTime.utc(2026, 1, 1),
    );
    final visits = FakeVisitListRepository(items: [todayVisit, yesterdayVisit]);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitRepositoryProvider.overrideWithValue(visits),
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsNothing);
    expect(find.byTooltip('Delete visit'), findsOneWidget);

    await tester.tap(find.text('Clear filters'));
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);

    await tester.tap(find.text('All customers'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi').last);
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsWidgets);
    expect(find.text('Maryam Karimi'), findsNothing);
  });

  testWidgets('staff does not see visit delete on the Visits screen', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitRepositoryProvider.overrideWithValue(
            FakeVisitListRepository(
              items: [
                Visit(
                  id: 'v1',
                  customerId: 'c1',
                  firstName: 'Sara',
                  lastName: 'Ahmadi',
                  visitedAt: DateTime.now(),
                  createdAt: DateTime.utc(2026, 1, 1),
                ),
              ],
            ),
          ),
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          authControllerProvider.overrideWith(_StaffAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('Delete visit'), findsNothing);
  });

  testWidgets('staff does not see customer or visit delete on detail', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWith(
            (ref) => FakeCustomerRepository(items: [_customer()]),
          ),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(),
          ),
          authControllerProvider.overrideWith(_StaffAuth.new),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('Delete customer'), findsNothing);
    expect(find.byTooltip('Delete visit'), findsNothing);
  });

  testWidgets('owner can confirm customer deletion and leave the page', (
    tester,
  ) async {
    final repo = FakeCustomerRepository(items: [_customer()]);
    final router = GoRouter(
      initialLocation: '/customers/c1',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/customers/:id',
          builder: (context, state) =>
              CustomerDetailScreen(customerId: state.pathParameters['id']!),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(repo),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(
              items: [
                Visit(
                  id: 'v1',
                  customerId: 'c1',
                  visitedAt: DateTime.utc(2026, 7, 6),
                  createdAt: DateTime.utc(2026, 7, 6),
                ),
              ],
            ),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Delete customer'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('permanently remove this customer'),
      findsNothing,
    );
    expect(find.textContaining('no financial records'), findsOneWidget);
    await tester.tap(find.text('Delete').last);
    await tester.pumpAndSettle();
    expect(repo.items, isEmpty);
    expect(find.text('No customers yet.'), findsOneWidget);
  });

  testWidgets('visit deletion from customer history requires confirmation', (
    tester,
  ) async {
    final visits = FakeVisitListRepository(
      items: [
        Visit(
          id: 'v1',
          customerId: 'c1',
          visitedAt: DateTime.utc(2026, 7, 6),
          createdAt: DateTime.utc(2026, 7, 6),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWith(
            (ref) => FakeCustomerRepository(items: [_customer()]),
          ),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          visitRepositoryProvider.overrideWith((ref) => visits),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Delete visit'));
    await tester.pumpAndSettle();
    expect(find.text('Delete this completed visit?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(visits.items, hasLength(1));
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Delete visit'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete').last);
    await tester.pumpAndSettle();
    expect(visits.items, isEmpty);
  });

  testWidgets('record sale lists backend services and submits the selected one', (
    tester,
  ) async {
    final transactions = FakeTransactionRepository();
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const Text('home')),
        GoRoute(
          path: '/sale',
          builder: (context, state) =>
              const RecordSaleScreen(customerId: 'c1'),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository(
              items: const [
                SalonService(id: 'svc-cut', name: 'Haircut', status: 'ACTIVE'),
                SalonService(id: 'svc-color', name: 'Color', status: 'ACTIVE'),
                SalonService(
                  id: 'svc-old',
                  name: 'Retired',
                  status: 'INACTIVE',
                ),
              ],
            ),
          ),
          transactionRepositoryProvider.overrideWithValue(transactions),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    router.push('/sale');
    await tester.pumpAndSettle();
    expect(find.text('Haircut'), findsOneWidget);
    expect(find.text('Retired'), findsNothing);

    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Color').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '150000.00');
    await tester.tap(find.text('Save sale'));
    await tester.pumpAndSettle();
    expect(transactions.lastServiceId, 'svc-color');
    expect(transactions.lastAmount, '150000.00');
  });

  testWidgets('record sale shows an empty state when the salon has no services', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceRepositoryProvider.overrideWithValue(FakeServiceRepository()),
        ],
        child: const MaterialApp(home: RecordSaleScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No services yet.'), findsOneWidget);
    expect(find.byType(DropdownButton<String>), findsNothing);
  });

  testWidgets('record sale shows retry when services fail to load', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository()..error = const NetworkException(),
          ),
        ],
        child: const MaterialApp(home: RecordSaleScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Unable to reach the salon platform.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('customer detail Add customer opens the existing create screen', (
    tester,
  ) async {
    final repo = FakeCustomerRepository(items: [_customer()]);
    final router = GoRouter(
      initialLocation: '/customers/c1',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/customers/new',
          builder: (context, state) => const CustomerFormScreen(),
        ),
        GoRoute(
          path: '/customers/:id',
          builder: (context, state) =>
              CustomerDetailScreen(customerId: state.pathParameters['id']!),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(repo),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add customer'));
    await tester.pumpAndSettle();
    expect(find.text('First name'), findsOneWidget);
    expect(find.text('Last name'), findsOneWidget);
    expect(find.text('Phone number'), findsOneWidget);
  });
}

class _StaffAuth extends AuthController {
  @override
  AuthState build() {
    return const AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(id: 'u2', tenantId: 't1', role: 'STAFF', name: 'Neda'),
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
