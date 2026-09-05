import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/auth/auth_screens.dart';
import 'package:salon_mobile/features/customers/customer_screens.dart';
import 'package:salon_mobile/features/dashboard/dashboard_screen.dart';
import 'package:salon_mobile/features/opportunities/opportunities_screen.dart';
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
  Future<List<Opportunity>> opportunities({String? type}) async {
    if (error != null) {
      throw error!;
    }
    if (type == null) {
      return opportunitiesData;
    }
    return opportunitiesData.where((item) => item.type == type).toList();
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
  Future<List<Customer>> list({String? query}) async {
    if (error != null) {
      throw error!;
    }
    if (query == null || query.isEmpty) {
      return items;
    }
    return items
        .where(
          (item) => item.fullName.toLowerCase().contains(query.toLowerCase()),
        )
        .toList();
  }

  @override
  Future<Customer> getById(String id) async {
    if (error != null) {
      throw error!;
    }
    return items.firstWhere((item) => item.id == id);
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
    return Customer(
      id: 'new',
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      createdAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
    );
  }
}

class FakeVisitListRepository extends VisitRepository {
  FakeVisitListRepository({this.items = const []}) : super(_client());

  List<Visit> items;

  @override
  Future<List<Visit>> listForCustomer(String customerId) async => items;
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
