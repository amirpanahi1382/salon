import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/admin/admin_message_queue_screen.dart';
import 'package:salon_mobile/features/auth/auth_screens.dart';
import 'package:salon_mobile/features/customers/customer_screens.dart';
import 'package:salon_mobile/features/dashboard/dashboard_screen.dart';
import 'package:salon_mobile/features/opportunities/opportunities_screen.dart';
import 'package:salon_mobile/features/outreach/outreach_message_composer.dart';
import 'package:salon_mobile/features/profile/profile_screen.dart';
import 'package:salon_mobile/features/services/service_screens.dart';
import 'package:salon_mobile/features/shell/app_shell.dart';
import 'package:salon_mobile/features/visits/visits_screen.dart';
import 'package:salon_mobile/shared/jalali.dart';
import 'package:salon_mobile/shared/labels.dart';
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
    return const SalonProfile(
      id: 's1',
      name: 'Rose Salon',
      status: 'ACTIVE',
      phone: '09120000000',
    );
  }
}

class FakeActionRepository extends ActionRepository {
  FakeActionRepository({this.items = const []}) : super(_client());

  List<OpportunityAction> items;
  Object? error;
  int createCalls = 0;
  int completeCalls = 0;
  int dismissCalls = 0;
  void Function()? onTerminal;

  @override
  Future<ItemPage<OpportunityAction>> list({
    String? status,
    String? customerId,
    String? cursor,
  }) async {
    if (error != null) {
      throw error!;
    }
    var filtered = items;
    if (status != null) {
      filtered = filtered.where((item) => item.status == status).toList();
    }
    if (customerId != null) {
      filtered =
          filtered.where((item) => item.customerId == customerId).toList();
    }
    return ItemPage(items: filtered, hasMore: false);
  }

  @override
  Future<ItemPage<OpportunityAction>> listForCustomer(
    String customerId, {
    String? status,
    String? cursor,
  }) {
    return list(status: status, customerId: customerId, cursor: cursor);
  }

  @override
  Future<OpportunityAction> create({
    required String customerId,
    required String opportunityType,
    required String idempotencyKey,
  }) async {
    createCalls += 1;
    if (error != null) {
      throw error!;
    }
    for (final item in items) {
      if (item.customerId == customerId &&
          item.opportunityType == opportunityType &&
          item.status == 'OPEN') {
        return item;
      }
    }
    final created = OpportunityAction(
      id: 'a-${items.length + 1}',
      customerId: customerId,
      firstName: 'Sara',
      lastName: 'Ahmadi',
      opportunityType: opportunityType,
      status: 'OPEN',
      createdBy: 'u1',
      createdAt: DateTime.utc(2026, 9, 9),
      updatedAt: DateTime.utc(2026, 9, 9),
    );
    items = [...items, created];
    return created;
  }

  @override
  Future<OpportunityAction> complete(String id) async {
    completeCalls += 1;
    if (error != null) {
      throw error!;
    }
    items = items
        .map(
          (item) => item.id == id
              ? OpportunityAction(
                  id: item.id,
                  customerId: item.customerId,
                  firstName: item.firstName,
                  lastName: item.lastName,
                  opportunityType: item.opportunityType,
                  status: 'COMPLETED',
                  createdBy: item.createdBy,
                  createdAt: item.createdAt,
                  updatedAt: DateTime.utc(2026, 9, 9),
                  completedAt: DateTime.utc(2026, 9, 9),
                )
              : item,
        )
        .toList();
    onTerminal?.call();
    return items.firstWhere((item) => item.id == id);
  }

  @override
  Future<OpportunityAction> dismiss(String id) async {
    dismissCalls += 1;
    if (error != null) {
      throw error!;
    }
    items = items
        .map(
          (item) => item.id == id
              ? OpportunityAction(
                  id: item.id,
                  customerId: item.customerId,
                  firstName: item.firstName,
                  lastName: item.lastName,
                  opportunityType: item.opportunityType,
                  status: 'DISMISSED',
                  createdBy: item.createdBy,
                  createdAt: item.createdAt,
                  updatedAt: DateTime.utc(2026, 9, 9),
                  dismissedAt: DateTime.utc(2026, 9, 9),
                )
              : item,
        )
        .toList();
    onTerminal?.call();
    return items.firstWhere((item) => item.id == id);
  }
}

class FakeMessageRepository extends MessageRepository {
  FakeMessageRepository({this.next, this.manualOutreach = const []}) : super(_client());

  MessageDelivery? next;
  List<ManualOutreachRequest> manualOutreach;
  Object? error;
  int sendCalls = 0;
  int listManualCalls = 0;
  String? lastText;

  @override
  Future<MessageDelivery> send({
    required String customerId,
    required String opportunityType,
    required String text,
    required String idempotencyKey,
  }) async {
    sendCalls += 1;
    lastText = text;
    if (error != null) {
      throw error!;
    }
    return next ??
        MessageDelivery(
          id: 'm1',
          customerId: customerId,
          actionId: 'a1',
          opportunityType: opportunityType,
          provider: 'BALE_SAFIR',
          channel: 'TEXT',
          status: 'QUEUED',
          body: text,
          destinationHint: '0912****111',
          createdBy: 'u1',
          createdAt: DateTime.utc(2026, 9, 9),
          updatedAt: DateTime.utc(2026, 9, 9),
        );
  }

  @override
  Future<MessageDelivery> sendManualOutreach({
    required String customerId,
    required String text,
    required String idempotencyKey,
  }) async {
    sendCalls += 1;
    lastText = text;
    if (error != null) {
      throw error!;
    }
    final created = next ??
        MessageDelivery(
          id: 'm-manual',
          customerId: customerId,
          channel: 'TEXT',
          status: 'QUEUED',
          body: text,
          destinationHint: '0912****111',
          createdBy: 'u1',
          createdAt: DateTime.utc(2026, 9, 9),
          updatedAt: DateTime.utc(2026, 9, 9),
        );
    manualOutreach = [
      ManualOutreachRequest(
        customerId: customerId,
        customerName: 'Sara Ahmadi',
        messageRequestId: created.id,
        status: created.status,
        requestedAt: created.createdAt,
        updatedAt: created.updatedAt,
      ),
      ...manualOutreach.where((item) => item.customerId != customerId),
    ];
    return created;
  }

  @override
  Future<ItemPage<ManualOutreachRequest>> listManualOutreach({String? cursor}) async {
    listManualCalls += 1;
    if (error != null) {
      throw error!;
    }
    return ItemPage(items: manualOutreach, hasMore: false);
  }

  @override
  Future<ItemPage<MessageDelivery>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    if (error != null) {
      throw error!;
    }
    return const ItemPage(items: [], hasMore: false);
  }

  @override
  Future<MessageDelivery> getById(String id) async {
    if (error != null) {
      throw error!;
    }
    return next ??
        MessageDelivery(
          id: id,
          customerId: 'c1',
          actionId: 'a1',
          opportunityType: 'REVENUE_DECLINE',
          provider: 'BALE_SAFIR',
          channel: 'TEXT',
          status: 'SENT',
          body: 'سلام',
          destinationHint: '0912****111',
          createdBy: 'u1',
          createdAt: DateTime.utc(2026, 9, 9),
          updatedAt: DateTime.utc(2026, 9, 9),
          submittedAt: DateTime.utc(2026, 9, 9),
        );
  }
}

class FakeOpenReturnCommitmentRepository extends ReturnCommitmentRepository {
  FakeOpenReturnCommitmentRepository({this.open = const []}) : super(_client());

  final List<OpenAgreedReturn> open;

  @override
  Future<ItemPage<OpenAgreedReturn>> listOpen({String? cursor}) async {
    return ItemPage(items: open, hasMore: false);
  }
}

class FakeVipRepository extends VipRepository {
  FakeVipRepository({this.entitled = false}) : super(_client());

  final bool entitled;

  @override
  Future<VipCapability> capability() async {
    return VipCapability(
      entitled: entitled,
      remainingQuota: 100,
      usedQuota: 0,
    );
  }
}

class FakeAdminMessageRepository extends AdminMessageRepository {
  FakeAdminMessageRepository(this.item) : super(_client());

  final AdminQueueItem item;

  @override
  Future<AdminQueueItem> getById(String id) async => item;
}

class FakeCustomerRepository extends CustomerRepository {
  FakeCustomerRepository({this.items = const [], this.pageSize}) : super(_client());

  List<Customer> items;
  Object? error;
  int? pageSize;
  int listCalls = 0;
  List<CustomerActivityItem> activity = const [];
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
  Future<Customer> getById(String id) async {
    if (error != null) {
      throw error!;
    }
    return items.firstWhere((item) => item.id == id);
  }

  @override
  Future<ItemPage<CustomerActivityItem>> listActivity(
    String customerId, {
    String? cursor,
  }) async {
    if (error != null) {
      throw error!;
    }
    return ItemPage(items: activity, hasMore: false);
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
  Completer<void>? gate;

  @override
  Future<ItemPage<SalonService>> list({
    bool includeInactive = false,
    String? cursor,
  }) async {
    final pending = gate;
    if (pending != null) {
      await pending.future;
    }
    if (error != null) {
      throw error!;
    }
    final filtered = includeInactive
        ? items
        : items.where((item) => item.status == 'ACTIVE').toList();
    return ItemPage(items: filtered, hasMore: false);
  }

  @override
  Future<SalonService> create(String name) async {
    if (error != null) {
      throw error!;
    }
    if (items.any((item) => item.name == name.trim())) {
      throw const ApiException(
        statusCode: 409,
        code: 'CONFLICT',
        message: 'A service with this name already exists',
      );
    }
    final created = SalonService(
      id: 'svc-${items.length + 1}',
      name: name.trim(),
      status: 'ACTIVE',
    );
    items = [...items, created];
    return created;
  }

  @override
  Future<SalonService> update({
    required String id,
    String? name,
    String? status,
  }) async {
    if (error != null) {
      throw error!;
    }
    final index = items.indexWhere((item) => item.id == id);
    if (index < 0) {
      throw const ApiException(
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Service not found',
      );
    }
    final current = items[index];
    final updated = SalonService(
      id: current.id,
      name: name?.trim() ?? current.name,
      status: status ?? current.status,
    );
    items = [...items]..[index] = updated;
    return updated;
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
  Future<ItemPage<Visit>> list({
    String? customerId,
    DateTime? day,
    String? cursor,
  }) async {
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
    return ItemPage(items: sorted, hasMore: false);
  }

  @override
  Future<void> delete(String id) async {
    if (error != null) {
      throw error!;
    }
    items = items.where((item) => item.id != id).toList();
  }

  int exportCalls = 0;
  String? lastExportCustomerId;
  DateTime? lastExportDay;
  Completer<void>? exportGate;
  Object? exportError;
  List<int> exportBytes = const [1, 2, 3];

  @override
  Future<List<int>> exportExcel({String? customerId, DateTime? day}) async {
    exportCalls += 1;
    lastExportCustomerId = customerId;
    lastExportDay = day;
    final pending = exportGate;
    if (pending != null) {
      await pending.future;
    }
    if (exportError != null) {
      throw exportError!;
    }
    return exportBytes;
  }

  String? lastServiceId;
  String? lastAmount;
  int saveCalls = 0;
  Completer<void>? saveGate;
  Object? saveError;

  @override
  Future<Visit> record({
    required String customerId,
    required DateTime visitedAt,
    required String idempotencyKey,
  }) async {
    saveCalls += 1;
    final pending = saveGate;
    if (pending != null) {
      await pending.future;
    }
    if (saveError != null) {
      throw saveError!;
    }
    final visit = Visit(
      id: 'v-new',
      customerId: customerId,
      visitedAt: visitedAt,
      createdAt: DateTime.utc(2026, 1, 1),
    );
    items = [visit, ...items];
    return visit;
  }

  @override
  Future<Visit> recordCompletedWithSale({
    required String customerId,
    required DateTime visitedAt,
    required String serviceId,
    required String amount,
    required String idempotencyKey,
  }) async {
    saveCalls += 1;
    lastServiceId = serviceId;
    lastAmount = amount;
    final pending = saveGate;
    if (pending != null) {
      await pending.future;
    }
    if (saveError != null) {
      throw saveError!;
    }
    final visit = Visit(
      id: 'v-sale',
      customerId: customerId,
      visitedAt: visitedAt,
      createdAt: DateTime.utc(2026, 1, 1),
    );
    items = [visit, ...items];
    return visit;
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
    await tester.tap(find.text('ورود'));
    await tester.pump();
    expect(find.text('ایمیل و رمز عبور را وارد کنید.'), findsOneWidget);
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
    await tester.tap(find.text('ورود'));
    await tester.pump();
    expect(find.textContaining('ایمیل یا رمز عبور درست نیست.'), findsOneWidget);
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeOpenReturnCommitmentRepository(),
          ),
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
    expect(find.textContaining('۵۲'), findsOneWidget);
    expect(
      find.textContaining('یک پیام یادآوری بفرستید'),
      findsOneWidget,
    );
    expect(find.text('ارسال پیام در بله'), findsOneWidget);
  });

  testWidgets('opportunity composer sends a Bale message after confirmation', (tester) async {
    final messages = FakeMessageRepository();
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          messageRepositoryProvider.overrideWithValue(messages),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeOpenReturnCommitmentRepository(),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: DashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('ارسال پیام در بله'), 400);
    await tester.pumpAndSettle();
    await tester.tap(find.text('ارسال پیام در بله'));
    await tester.pumpAndSettle();
    expect(find.text('ارسال پیام در بله'), findsWidgets);
    await tester.tap(find.text('ارسال'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ارسال').last);
    await tester.pumpAndSettle();
    expect(messages.sendCalls, 1);
    expect(find.text('پیام در صف ارسال قرار گرفت.'), findsOneWidget);
  });

  testWidgets('dashboard empty state', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(summaryData: _summary()),
          ),
          salonRepositoryProvider.overrideWith((ref) => FakeSalonRepository()),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeOpenReturnCommitmentRepository(),
          ),
        ],
        child: const MaterialApp(home: DashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('الان مورد فوری ندارید.'), findsOneWidget);
  });

  testWidgets('customer list empty and list states', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('هنوز مشتری‌ای ثبت نشده.'), findsOneWidget);
    expect(find.text('ورود اطلاعات از اکسل'), findsWidgets);
  });

  testWidgets('customer list loads the next page with cursor', (tester) async {
    final repo = FakeCustomerRepository(
      items: [
        _customer(),
        Customer(
          id: 'c2',
          firstName: 'Maryam',
          lastName: 'Karimi',
          phoneNumber: '09121111111',
          createdAt: DateTime.utc(2026, 1, 2),
          updatedAt: DateTime.utc(2026, 1, 2),
        ),
      ],
      pageSize: 1,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(repo),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);
    expect(repo.listCalls, greaterThanOrEqualTo(2));
    expect(repo.lastCursor, isNotNull);
  });

  testWidgets('customer list renders names', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
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
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارتباط با سامانه سالن برقرار نشد.'), findsOneWidget);
    expect(find.text('تلاش مجدد'), findsOneWidget);
  });

  testWidgets('opportunities render reason and action', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.textContaining('۵۲'), findsOneWidget);
  });

  testWidgets('opportunity action buttons complete and dismiss', (tester) async {
    final actions = FakeActionRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(actions),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('اقدام انجام شد'), findsWidgets);
    await tester.tap(find.text('اقدام انجام شد').first);
    await tester.pumpAndSettle();
    expect(actions.createCalls, 1);
    expect(actions.completeCalls, 1);
  });

  testWidgets('complete hides opportunity card and shows one recent action', (
    tester,
  ) async {
    final intel = FakeIntelligenceRepository(
      opportunitiesData: [_opportunity()],
    );
    final actions = FakeActionRepository()
      ..onTerminal = () {
        intel.opportunitiesData = const [];
      };
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(intel),
          actionRepositoryProvider.overrideWithValue(actions),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('اقدام انجام شد'), findsWidgets);
    await tester.tap(find.text('اقدام انجام شد').first);
    await tester.pump();
    await tester.tap(find.text('اقدام انجام شد').first);
    await tester.pumpAndSettle();
    expect(actions.completeCalls, 1);
    expect(
      find.widgetWithText(FilledButton, AppStrings.markActionDone),
      findsNothing,
    );
    expect(find.text(AppStrings.actionHistory), findsOneWidget);
    expect(find.text('Sara Ahmadi'), findsWidgets);
  });

  testWidgets('ignore hides opportunity card and does not show recent action', (
    tester,
  ) async {
    final intel = FakeIntelligenceRepository(
      opportunitiesData: [_opportunity()],
    );
    final actions = FakeActionRepository()
      ..onTerminal = () {
        intel.opportunitiesData = const [];
      };
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(intel),
          actionRepositoryProvider.overrideWithValue(actions),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('نادیده گرفتن').first);
    await tester.pumpAndSettle();
    expect(actions.dismissCalls, 1);
    expect(find.text('اقدام انجام شد'), findsNothing);
    expect(find.text(AppStrings.actionHistory), findsNothing);
    expect(find.text(AppStrings.dismissAction), findsNothing);
  });

  testWidgets('failed complete keeps the opportunity card', (tester) async {
    final actions = FakeActionRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(actions),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    actions.error = const NetworkException();
    await tester.tap(find.text('اقدام انجام شد').first);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, AppStrings.markActionDone), findsWidgets);
    expect(find.text(AppStrings.actionHistory), findsNothing);
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(
              items: [
                Visit(
                  id: 'v1',
                  customerId: 'c1',
                  visitedAt: DateTime.utc(2026, 7, 6),
                  createdAt: DateTime.utc(2026, 7, 6),
                  serviceName: 'Hair Service',
                  amountReceived: '8000000.00',
                ),
              ],
            ),
          ),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('در آستانه از دست رفتن'), findsWidgets);
    expect(find.textContaining('۵۲'), findsWidgets);
    expect(find.textContaining('یک پیام یادآوری بفرستید'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('Hair Service · 8000000.00 ریال'), findsOneWidget);
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
    expect(find.text('این مورد پیدا نشد.'), findsOneWidget);
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
    await tester.tap(find.text('ذخیره'));
    await tester.pumpAndSettle();
    expect(find.text('برای این کار دسترسی ندارید.'), findsOneWidget);
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
    await tester.tap(find.text('ذخیره'));
    await tester.pump();
    expect(
      find.text('شماره موبایل باید دقیقاً ۱۱ رقم باشد و با ۰۹ شروع شود.'),
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
        overrides: [
          customerRepositoryProvider.overrideWithValue(repo),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('هنوز مشتری‌ای ثبت نشده.'), findsOneWidget);

    await tester.tap(find.text('افزودن مشتری').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'سارا');
    await tester.enterText(find.byType(TextField).at(1), 'احمدی');
    await tester.enterText(find.byType(TextField).at(2), '09121111111');
    await tester.tap(find.text('ذخیره'));
    await tester.pumpAndSettle();
    expect(find.text('مشتری با موفقیت اضافه شد'), findsOneWidget);
    expect(find.text('بازگشت به مشتریان'), findsOneWidget);

    await tester.tap(find.text('بازگشت به مشتریان'));
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
    expect(find.text('نوبت انجام شده'), findsOneWidget);
    await tester.tap(find.text('نوبت انجام شده'));
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
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsNothing);
    expect(find.byTooltip('حذف نوبت انجام شده'), findsOneWidget);

    await tester.tap(find.text('پاک کردن فیلترها'));
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);

    await tester.tap(find.text('همه مشتریان'));
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
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          authControllerProvider.overrideWith(_StaffAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('حذف نوبت انجام شده'), findsNothing);
  });

  testWidgets('visit rows show service and amount received', (tester) async {
    final hairAt = DateTime(2026, 6, 10, 14, 30);
    final nailAt = DateTime(2026, 6, 11, 11, 0);
    final visitOnlyAt = DateTime(2026, 6, 1, 9, 0);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitRepositoryProvider.overrideWithValue(
            FakeVisitListRepository(
              items: [
                Visit(
                  id: 'v-hair',
                  customerId: 'c1',
                  firstName: 'Maryam',
                  lastName: 'Ahmadi',
                  visitedAt: hairAt,
                  createdAt: DateTime.utc(2026, 6, 10),
                  serviceName: 'Hair Service',
                  amountReceived: '8000000.00',
                ),
                Visit(
                  id: 'v-nail',
                  customerId: 'c2',
                  firstName: 'Sara',
                  lastName: 'Mohammadi',
                  visitedAt: nailAt,
                  createdAt: DateTime.utc(2026, 6, 11),
                  serviceName: 'Nail Service',
                  amountReceived: '5000000.00',
                ),
                Visit(
                  id: 'v-only',
                  customerId: 'c3',
                  firstName: 'Leila',
                  lastName: 'Karimi',
                  visitedAt: visitOnlyAt,
                  createdAt: DateTime.utc(2026, 6, 1),
                ),
              ],
            ),
          ),
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'پاک کردن فیلترها'));
    await tester.pumpAndSettle();
    expect(find.text('Maryam Ahmadi'), findsOneWidget);
    expect(find.text('Sara Mohammadi'), findsOneWidget);
    expect(find.text('Leila Karimi'), findsOneWidget);
    expect(find.text('Hair Service'), findsOneWidget);
    expect(find.text('Nail Service'), findsOneWidget);
    expect(find.text('8000000.00 ریال'), findsOneWidget);
    expect(find.text('5000000.00 ریال'), findsOneWidget);
    expect(find.text('—'), findsNWidgets(2));
    expect(
      find.text(formatJalaliDateTime(hairAt)),
      findsOneWidget,
    );
    expect(
      find.text(formatJalaliDateTime(nailAt)),
      findsOneWidget,
    );
    expect(find.text('خروجی اکسل'), findsOneWidget);
  });

  testWidgets('export uses current filters and blocks duplicate taps', (
    tester,
  ) async {
    final gate = Completer<void>();
    final visits = FakeVisitListRepository(
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
    )..exportGate = gate;
    String? savedName;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitRepositoryProvider.overrideWithValue(visits),
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          visitExcelSaverProvider.overrideWithValue(({
            required bytes,
            required fileName,
          }) async {
            savedName = fileName;
            return Uri.parse('file:///visits.xlsx');
          }),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('خروجی اکسل'));
    await tester.pump();
    expect(visits.exportCalls, 1);
    expect(visits.lastExportCustomerId, isNull);
    expect(visits.lastExportDay, isNotNull);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.byType(CircularProgressIndicator));
    await tester.pump();
    expect(visits.exportCalls, 1);
    gate.complete();
    await tester.pumpAndSettle();
    expect(savedName, 'visits.xlsx');
    expect(find.text('فایل اکسل ذخیره شد.'), findsOneWidget);
  });

  testWidgets('export passes the selected customer filter to the backend', (
    tester,
  ) async {
    final visits = FakeVisitListRepository(
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
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitRepositoryProvider.overrideWithValue(visits),
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          visitExcelSaverProvider.overrideWithValue(({
            required bytes,
            required fileName,
          }) async {
            return Uri.parse('file:///visits.xlsx');
          }),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('پاک کردن فیلترها'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('همه مشتریان'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sara Ahmadi').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('خروجی اکسل'));
    await tester.pumpAndSettle();
    expect(visits.lastExportCustomerId, 'c1');
    expect(visits.lastExportDay, isNull);
  });

  testWidgets('export error is shown without a second in-flight request', (
    tester,
  ) async {
    final visits = FakeVisitListRepository()
      ..exportError = const ApiException(
        statusCode: 500,
        code: 'HTTP_ERROR',
        message: 'Export failed',
      );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitRepositoryProvider.overrideWithValue(visits),
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: VisitsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('خروجی اکسل'));
    await tester.pumpAndSettle();
    expect(visits.exportCalls, 1);
    expect(find.text('خروجی اکسل گرفته نشد.'), findsOneWidget);
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(),
          ),
          authControllerProvider.overrideWith(_StaffAuth.new),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('حذف مشتری'), findsNothing);
    expect(find.byTooltip('حذف نوبت انجام شده'), findsNothing);
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
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
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
    await tester.tap(find.byTooltip('حذف مشتری'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('سابقه مالی'),
      findsOneWidget,
    );
    expect(find.textContaining('تاریخچه'), findsOneWidget);
    await tester.tap(find.text('حذف').last);
    await tester.pumpAndSettle();
    expect(find.text('هنوز مشتری‌ای ثبت نشده.'), findsOneWidget);
    expect(repo.items, isEmpty);
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWith((ref) => visits),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('حذف نوبت انجام شده'));
    await tester.pumpAndSettle();
    expect(find.text('این نوبت انجام شده حذف شود؟'), findsOneWidget);
    await tester.tap(find.text('لغو'));
    await tester.pumpAndSettle();
    expect(visits.items, hasLength(1));
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('حذف نوبت انجام شده'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حذف').last);
    await tester.pumpAndSettle();
    expect(visits.items, isEmpty);
  });

  testWidgets('customer detail uses Record completed visit and not Record sale', (
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ثبت مراجعه انجام‌شده'), findsOneWidget);
    expect(find.text('Record sale'), findsNothing);
    await tester.scrollUntilVisible(find.textContaining('درآمد ثبت‌شده'), 400);
    expect(find.textContaining('درآمد ثبت‌شده'), findsOneWidget);
  });

  testWidgets('record completed visit lists backend services and submits the selected one', (
    tester,
  ) async {
    final visits = FakeVisitListRepository();
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const Text('home')),
        GoRoute(
          path: '/visit',
          builder: (context, state) =>
              const RecordVisitScreen(customerId: 'c1'),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository(
              items: const [
                SalonService(
                  id: 'svc-hair',
                  name: 'Hair Service',
                  status: 'ACTIVE',
                ),
                SalonService(
                  id: 'svc-nail',
                  name: 'Nail Service',
                  status: 'ACTIVE',
                ),
                SalonService(
                  id: 'svc-old',
                  name: 'Retired',
                  status: 'INACTIVE',
                ),
              ],
            ),
          ),
          visitRepositoryProvider.overrideWithValue(visits),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    router.push('/visit');
    await tester.pumpAndSettle();
    expect(find.text('Hair Service'), findsOneWidget);
    expect(find.text('Retired'), findsNothing);

    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    expect(find.text('Nail Service'), findsWidgets);
    await tester.tap(find.text('Nail Service').last);
    await tester.pumpAndSettle();
    expect(find.text('Nail Service'), findsOneWidget);

    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hair Service').last);
    await tester.pumpAndSettle();
    expect(find.text('Hair Service'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '8000000');
    await tester.tap(find.text('ثبت این مراجعه'));
    await tester.pumpAndSettle();
    expect(visits.lastServiceId, 'svc-hair');
    expect(visits.lastAmount, '8000000');
    expect(visits.saveCalls, 1);
  });

  testWidgets('record completed visit shows an empty state when the salon has no services', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(FakeServiceRepository()),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('هیچ خدمت فعالی وجود ندارد.'), findsOneWidget);
    expect(find.text('مدیریت خدمات'), findsOneWidget);
    expect(find.byType(DropdownButton<String>), findsNothing);
  });

  testWidgets('record completed visit shows a loading state before services arrive', (
    tester,
  ) async {
    final repo = FakeServiceRepository(
      items: const [
        SalonService(id: 'svc-hair', name: 'Hair Service', status: 'ACTIVE'),
      ],
    )..gate = Completer<void>();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(repo),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsWidgets);
    expect(find.text('Hair Service'), findsNothing);
    repo.gate!.complete();
    await tester.pumpAndSettle();
    expect(find.text('Hair Service'), findsOneWidget);
  });

  testWidgets('record completed visit shows retry when services fail to load', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository()..error = const NetworkException(),
          ),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارتباط با سامانه سالن برقرار نشد.'), findsOneWidget);
    expect(find.text('تلاش مجدد'), findsOneWidget);
  });

  testWidgets('record completed visit does not double-submit while saving', (
    tester,
  ) async {
    final visits = FakeVisitListRepository()..saveGate = Completer<void>();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository(
              items: const [
                SalonService(
                  id: 'svc-hair',
                  name: 'Hair Service',
                  status: 'ACTIVE',
                ),
              ],
            ),
          ),
          visitRepositoryProvider.overrideWithValue(visits),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '8000000.00');
    await tester.tap(find.text('ثبت این مراجعه'));
    await tester.pump();
    expect(visits.saveCalls, 1);
    await tester.tap(find.byType(FilledButton));
    await tester.pump();
    expect(visits.saveCalls, 1);
    visits.saveGate!.complete();
    await tester.pumpAndSettle();
  });

  testWidgets('record completed visit shows save errors and can retry', (
    tester,
  ) async {
    final visits = FakeVisitListRepository()
      ..saveError = const NetworkException();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository(
              items: const [
                SalonService(
                  id: 'svc-hair',
                  name: 'Hair Service',
                  status: 'ACTIVE',
                ),
              ],
            ),
          ),
          visitRepositoryProvider.overrideWithValue(visits),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '8000000.00');
    await tester.tap(find.text('ثبت این مراجعه'));
    await tester.pumpAndSettle();
    expect(find.text('ارتباط با سامانه سالن برقرار نشد.'), findsOneWidget);
    visits.saveError = null;
    await tester.tap(find.text('ثبت این مراجعه'));
    await tester.pumpAndSettle();
    expect(visits.saveCalls, 2);
  });

  testWidgets('staff record completed visit does not load a sale form', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StaffAuth.new),
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository(
              items: const [
                SalonService(
                  id: 'svc-hair',
                  name: 'Hair Service',
                  status: 'ACTIVE',
                ),
              ],
            ),
          ),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hair Service'), findsNothing);
    expect(find.text('مبلغ دریافتی (ریال)'), findsNothing);
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
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          intelligenceRepositoryProvider.overrideWith(
            (ref) => FakeIntelligenceRepository(
              customerIntelligence: _intelligence(),
            ),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('افزودن مشتری'));
    await tester.pumpAndSettle();
    expect(find.text('نام'), findsOneWidget);
    expect(find.text('نام خانوادگی'), findsOneWidget);
    expect(find.text('شماره موبایل'), findsOneWidget);
  });

  testWidgets('owner profile links to service management', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepository()),
        ],
        child: const MaterialApp(home: ProfileScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('مدیریت خدمات'), findsOneWidget);
  });

  testWidgets('customer detail keeps an inactive historical service name', (
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
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWith(
            (ref) => FakeVisitListRepository(
              items: [
                Visit(
                  id: 'v-old',
                  customerId: 'c1',
                  visitedAt: DateTime.utc(2026, 1, 15),
                  createdAt: DateTime.utc(2026, 1, 15),
                  serviceName: 'Hair Botox Premium',
                  amountReceived: '8000000.00',
                ),
              ],
            ),
          ),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('Hair Botox Premium · 8000000.00 ریال'), findsOneWidget);
  });

  testWidgets('owner can list, create, edit, and deactivate services', (
    tester,
  ) async {
    final repo = FakeServiceRepository(
      items: const [
        SalonService(id: 'svc-hair', name: 'Hair Service', status: 'ACTIVE'),
        SalonService(id: 'svc-old', name: 'Coloring', status: 'INACTIVE'),
      ],
    );
    final router = GoRouter(
      initialLocation: '/profile/services',
      routes: [
        GoRoute(
          path: '/profile/services',
          builder: (context, state) => const ServiceManagementScreen(),
        ),
        GoRoute(
          path: '/profile/services/new',
          builder: (context, state) => const ServiceFormScreen(),
        ),
        GoRoute(
          path: '/profile/services/:id/edit',
          builder: (context, state) {
            final extra = state.extra;
            if (extra is SalonService) {
              return ServiceFormScreen(service: extra);
            }
            return const ServiceFormScreen();
          },
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(repo),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hair Service'), findsOneWidget);
    expect(find.text('Coloring'), findsOneWidget);
    expect(find.text('فعال'), findsOneWidget);
    expect(find.text('غیرفعال'), findsOneWidget);

    await tester.tap(find.text('افزودن خدمت'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Hair Botox');
    await tester.tap(find.text('ذخیره'));
    await tester.pumpAndSettle();
    expect(find.text('Hair Botox'), findsOneWidget);

    await tester.tap(find.byType(PopupMenuButton<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('ویرایش خدمت'));
    await tester.pumpAndSettle();
    expect(find.text('Hair Service'), findsWidgets);
    await tester.enterText(find.byType(TextField), 'Hair Botox Premium');
    await tester.tap(find.text('ذخیره'));
    await tester.pumpAndSettle();
    expect(find.text('Hair Botox Premium'), findsOneWidget);

    await tester.tap(find.byType(PopupMenuButton<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('غیرفعال کردن'));
    await tester.pumpAndSettle();
    expect(find.text('این خدمت غیرفعال شود؟'), findsOneWidget);
    await tester.tap(find.text('غیرفعال کردن').last);
    await tester.pumpAndSettle();
    expect(repo.items.first.status, 'INACTIVE');
  });

  testWidgets('create service shows duplicate and empty errors', (tester) async {
    final repo = FakeServiceRepository(
      items: const [
        SalonService(id: 'svc-hair', name: 'Hair Service', status: 'ACTIVE'),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(repo),
        ],
        child: const MaterialApp(home: ServiceFormScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('ذخیره'));
    await tester.pump();
    expect(find.text('نام خدمت را وارد کنید.'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Hair Service');
    await tester.tap(find.text('ذخیره'));
    await tester.pumpAndSettle();
    expect(find.text('خدمتی با این نام از قبل وجود دارد.'), findsOneWidget);
  });

  testWidgets('record completed visit hides inactive catalog services', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SignedInAuth.new),
          serviceRepositoryProvider.overrideWithValue(
            FakeServiceRepository(
              items: const [
                SalonService(
                  id: 'svc-botox',
                  name: 'Hair Botox Premium',
                  status: 'INACTIVE',
                ),
              ],
            ),
          ),
        ],
        child: const MaterialApp(home: RecordVisitScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hair Botox Premium'), findsNothing);
    expect(find.text('هیچ خدمت فعالی وجود ندارد.'), findsOneWidget);
  });

  testWidgets('customer multi-select navigates to outreach on opportunities', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1400);
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
          builder: (context, state) => const OpportunitiesScreen(),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(
              items: [
                _customer(),
                Customer(
                  id: 'c2',
                  firstName: 'Maryam',
                  lastName: 'Karimi',
                  phoneNumber: '09121111111',
                  createdAt: DateTime.utc(2026, 1, 2),
                  updatedAt: DateTime.utc(2026, 1, 2),
                ),
              ],
            ),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('انتخاب چند مشتری'));
    await tester.pumpAndSettle();
    expect(find.text('انتخاب مشتری 0 / 30'), findsOneWidget);
    await tester.tap(find.byType(CheckboxListTile).at(0));
    await tester.pumpAndSettle();
    expect(find.text('انتخاب مشتری 1 / 30'), findsOneWidget);
    await tester.tap(find.byType(CheckboxListTile).at(1));
    await tester.pumpAndSettle();
    expect(find.text('انتخاب مشتری 2 / 30'), findsOneWidget);
    await tester.tap(find.text('ارسال پیام'));
    await tester.pumpAndSettle();
    expect(find.text('ایجاد پیام مناسب'), findsNWidgets(2));
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);
  });

  testWidgets('outreach composer generates, edits, and queues a message', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final messages = FakeMessageRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepository()),
          messageRepositoryProvider.overrideWithValue(messages),
        ],
        child: const MaterialApp(
          home: Scaffold(body: OutreachMessageComposer(customerId: 'c1')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ایجاد پیام مناسب'), findsOneWidget);
    expect(find.text('Sara'), findsOneWidget);
    expect(find.text('Rose Salon'), findsOneWidget);
    expect(find.text('فردا'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'ساعت'), '18:00');
    await tester.enterText(
      find.widgetWithText(TextField, 'تخفیف (هزار تومان)'),
      '200',
    );
    await tester.tap(find.text('ارسال پیام').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'ارسال پیام').last);
    await tester.pumpAndSettle();
    expect(messages.sendCalls, 1);
    expect(find.text('پیام در صف ارسال قرار گرفت.'), findsOneWidget);
    expect(messages.lastText, contains('18:00'));
  });

  testWidgets('outreach composer shows daily limit error', (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepository()),
          messageRepositoryProvider.overrideWithValue(
            FakeMessageRepository()
              ..error = const ApiException(
                statusCode: 409,
                code: 'MESSAGE_DAILY_LIMIT_REACHED',
                message: 'limit',
              ),
          ),
        ],
        child: const MaterialApp(
          home: Scaffold(body: OutreachMessageComposer(customerId: 'c1')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'ساعت'), '18:00');
    await tester.enterText(
      find.widgetWithText(TextField, 'تخفیف (هزار تومان)'),
      '200',
    );
    await tester.tap(find.text('ارسال پیام').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'ارسال پیام').last);
    await tester.pumpAndSettle();
    expect(find.text('برای این مشتری امروز قبلاً پیام ثبت شده است.'), findsOneWidget);
  });

  testWidgets('submitted outreach stays visible, disabled, and shows server status', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final messages = FakeMessageRepository();
    final router = GoRouter(
      initialLocation: '/customers',
      routes: [
        GoRoute(
          path: '/customers',
          builder: (context, state) => const CustomersScreen(),
        ),
        GoRoute(
          path: '/opportunities',
          builder: (context, state) => const OpportunitiesScreen(),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(
              items: [
                _customer(),
                Customer(
                  id: 'c2',
                  firstName: 'Maryam',
                  lastName: 'Karimi',
                  phoneNumber: '09121111111',
                  createdAt: DateTime.utc(2026, 1, 2),
                  updatedAt: DateTime.utc(2026, 1, 2),
                ),
              ],
            ),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepository()),
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          messageRepositoryProvider.overrideWithValue(messages),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('انتخاب چند مشتری'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile).at(0));
    await tester.tap(find.byType(CheckboxListTile).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ارسال پیام'));
    await tester.pumpAndSettle();
    expect(find.text('ایجاد پیام مناسب'), findsNWidgets(2));

    await tester.tap(find.text('ایجاد پیام مناسب').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'ساعت'), '18:00');
    await tester.enterText(
      find.widgetWithText(TextField, 'تخفیف (هزار تومان)'),
      '200',
    );
    await tester.tap(
      find.descendant(
        of: find.byType(OutreachMessageComposer),
        matching: find.widgetWithText(FilledButton, 'ارسال پیام'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'ارسال پیام').last);
    await tester.pumpAndSettle();
    expect(find.text('پیام در صف ارسال قرار گرفت.'), findsOneWidget);
    Navigator.of(tester.element(find.text('پیام در صف ارسال قرار گرفت.'))).pop();
    await tester.pumpAndSettle();

    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);
    expect(find.text('در صف ارسال'), findsOneWidget);
    expect(find.text('ایجاد پیام مناسب'), findsOneWidget);

    await tester.tap(find.text('Sara Ahmadi'), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(find.byType(OutreachMessageComposer), findsNothing);

    final callsBeforeReload = messages.listManualCalls;
    await tester.tap(find.widgetWithText(ChoiceChip, 'همه'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, 'ارسال پیام'));
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);
    expect(find.text('در صف ارسال'), findsOneWidget);
    expect(find.text('ایجاد پیام مناسب'), findsOneWidget);
    expect(messages.listManualCalls, greaterThan(callsBeforeReload));
  });

  testWidgets('outreach list shows dispatched status from the server after reload', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final messages = FakeMessageRepository(
      manualOutreach: [
        ManualOutreachRequest(
          customerId: 'c1',
          customerName: 'Sara Ahmadi',
          messageRequestId: 'm1',
          status: 'DISPATCHED',
          requestedAt: DateTime.utc(2026, 9, 11),
          updatedAt: DateTime.utc(2026, 9, 11),
        ),
        ManualOutreachRequest(
          customerId: 'c2',
          customerName: 'Maryam Karimi',
          messageRequestId: 'm2',
          status: 'QUEUED',
          requestedAt: DateTime.utc(2026, 9, 11),
          updatedAt: DateTime.utc(2026, 9, 11),
        ),
        ManualOutreachRequest(
          customerId: 'c3',
          customerName: 'Neda Rezaei',
          messageRequestId: 'm3',
          status: 'SENT',
          requestedAt: DateTime.utc(2026, 9, 11),
          updatedAt: DateTime.utc(2026, 9, 11),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          messageRepositoryProvider.overrideWithValue(messages),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, 'ارسال پیام'));
    await tester.pumpAndSettle();
    expect(find.text('Sara Ahmadi'), findsOneWidget);
    expect(find.text('Maryam Karimi'), findsOneWidget);
    expect(find.text('Neda Rezaei'), findsOneWidget);
    expect(find.text('ارسال به اجرا'), findsOneWidget);
    expect(find.text('در صف ارسال'), findsOneWidget);
    expect(find.text('ارسال شد'), findsOneWidget);
    expect(find.text('ایجاد پیام مناسب'), findsNothing);
    expect(messages.listManualCalls, greaterThan(0));
  });

  testWidgets('customer profile shows manual outreach activity status', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()])
              ..activity = [
                CustomerActivityItem(
                  id: 'm1',
                  type: 'MANUAL_MESSAGE',
                  occurredAt: DateTime.utc(2026, 9, 11, 7, 5),
                  createdAt: DateTime.utc(2026, 9, 11, 7, 5),
                  status: 'QUEUED',
                ),
              ],
          ),
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(customerIntelligence: _intelligence()),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          visitRepositoryProvider.overrideWithValue(FakeVisitListRepository()),
        ],
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('فعالیت مشتری'), findsOneWidget);
    expect(find.text('ارسال پیام'), findsOneWidget);
    expect(find.textContaining('در صف ارسال'), findsOneWidget);
  });

  testWidgets('non-VIP salon hides customer VIP send action', (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارسال پیام vip'), findsNothing);
  });

  testWidgets('entitled salon shows customer VIP send action', (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(
            FakeCustomerRepository(items: [_customer()]),
          ),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository(entitled: true)),
        ],
        child: const MaterialApp(home: CustomersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارسال پیام vip'), findsOneWidget);
  });

  testWidgets('non-VIP salon hides opportunities VIP chip', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository()),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارسال پیام vip'), findsNothing);
  });

  testWidgets('entitled salon shows opportunities VIP chip', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          intelligenceRepositoryProvider.overrideWithValue(
            FakeIntelligenceRepository(opportunitiesData: [_opportunity()]),
          ),
          actionRepositoryProvider.overrideWithValue(FakeActionRepository()),
          vipRepositoryProvider.overrideWithValue(FakeVipRepository(entitled: true)),
        ],
        child: const MaterialApp(home: OpportunitiesScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارسال پیام vip'), findsOneWidget);
  });

  testWidgets('VIP queue items hide Bale and keep manual send', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            FakeAdminMessageRepository(
              AdminQueueItem(
                id: 'q1',
                salonId: 's1',
                salonName: 'Rose Salon',
                customerId: '',
                customerName: 'VIP recipient',
                customerPhone: '0912****111',
                messageText: 'سلام',
                requestedAt: DateTime.utc(2026, 9, 11),
                status: 'QUEUED',
                attempts: 0,
                providerReady: true,
                vipRequestId: 'vip-1',
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: AdminMessageDetailSheet(itemId: 'q1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ارسال با بله'), findsNothing);
    expect(find.text('ارسال دستی'), findsOneWidget);
  });

  testWidgets('admin SENT customer message can record agreed return', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            FakeAdminMessageRepository(
              AdminQueueItem(
                id: 'q-sent',
                salonId: 's1',
                salonName: 'Rose Salon',
                customerId: 'c1',
                customerName: 'Sara Ahmadi',
                customerPhone: '09121111111',
                messageText: 'سلام',
                requestedAt: DateTime.utc(2026, 9, 11),
                status: 'SENT',
                deliveryStatus: 'SENT',
                attempts: 1,
                providerReady: true,
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: AdminMessageDetailSheet(itemId: 'q-sent')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recordAgreedReturn), findsOneWidget);
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
