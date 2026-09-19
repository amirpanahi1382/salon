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
import 'package:salon_mobile/features/outreach/outreach_message_composer.dart';
import 'package:salon_mobile/features/recovery/open_agreed_returns_section.dart';
import 'package:salon_mobile/features/recovery/recovery_presentation.dart';
import 'package:salon_mobile/features/recovery/return_commitment_form.dart';
import 'package:salon_mobile/shared/phone_launcher.dart';
import 'package:salon_mobile/shared/jalali.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

Customer _customer() {
  return Customer(
    id: 'c1',
    firstName: 'Sara',
    lastName: 'Ahmadi',
    phoneNumber: '09121111111',
    createdAt: DateTime.utc(2026, 6, 1),
    updatedAt: DateTime.utc(2026, 6, 1),
  );
}

MessageDelivery _message({
  required String id,
  required String status,
  ReturnCommitmentSummary? commitment,
  String? opportunityType,
}) {
  return MessageDelivery(
    id: id,
    customerId: 'c1',
    opportunityType: opportunityType,
    channel: 'TEXT',
    status: status,
    body: 'سلام',
    destinationHint: '0912****111',
    createdBy: 'u1',
    createdAt: DateTime.utc(2026, 9, 10, 10),
    updatedAt: DateTime.utc(2026, 9, 10, 10),
    submittedAt: status == 'SENT' ? DateTime.utc(2026, 9, 10, 10, 5) : null,
    returnCommitment: commitment,
  );
}

ReturnCommitment _commitment({
  required String id,
  required DateTime expectedAt,
  String? actualVisitId,
  CommitmentBackedReturn? backed,
  DateTime? updatedAt,
  bool? operationallyOpen,
}) {
  return ReturnCommitment(
    id: id,
    customerId: 'c1',
    sourceRequestId: 'm-sent',
    sourceDeliveryId: 'd1',
    expectedAt: expectedAt,
    actualVisitId: actualVisitId,
    createdAt: DateTime.utc(2026, 9, 10),
    updatedAt: updatedAt ?? DateTime.utc(2026, 9, 10),
    commitmentBackedReturn: backed,
    operationallyOpen: operationallyOpen,
  );
}

class FakeMessageRepo extends MessageRepository {
  FakeMessageRepo(this.items) : super(_client());

  List<MessageDelivery> items;

  @override
  Future<ItemPage<MessageDelivery>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    return ItemPage(items: items, hasMore: false);
  }
}

class FakeVisitRepo extends VisitRepository {
  FakeVisitRepo() : super(_client());

  int recordCalls = 0;

  @override
  Future<ItemPage<Visit>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    return const ItemPage(items: [], hasMore: false);
  }

  @override
  Future<Visit> record({
    required String customerId,
    required DateTime visitedAt,
    required String idempotencyKey,
  }) async {
    recordCalls += 1;
    return Visit(
      id: 'v-generic',
      customerId: customerId,
      visitedAt: visitedAt,
      createdAt: DateTime.utc(2026, 1, 1),
    );
  }
}

class FakeReturnCommitmentRepo extends ReturnCommitmentRepository {
  FakeReturnCommitmentRepo({
    this.commitments = const [],
    this.observed = const [],
    this.upcoming = const [],
    this.open = const [],
    this.upcomingError,
    this.updateError,
    this.arriveError,
  }) : super(_client());

  List<ReturnCommitment> commitments;
  List<ObservedReturn> observed;
  List<UpcomingReturnCommitment> upcoming;
  List<OpenAgreedReturn> open = const [];
  Object? upcomingError;
  Object? updateError;
  Object? arriveError;
  int createCalls = 0;
  int updateCalls = 0;
  int arriveCalls = 0;
  DateTime? lastExpectedAt;
  DateTime? lastVisitedAt;
  String? lastArriveId;
  String? lastSaleAmount;

  @override
  Future<ItemPage<ReturnCommitment>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    return ItemPage(items: commitments, hasMore: false);
  }

  @override
  Future<ItemPage<ObservedReturn>> listObservedReturns(
    String customerId, {
    String? cursor,
  }) async {
    return ItemPage(items: observed, hasMore: false);
  }

  @override
  Future<UpcomingReturnCommitmentPage> listUpcoming({String? cursor}) async {
    if (upcomingError != null) {
      throw upcomingError!;
    }
    return UpcomingReturnCommitmentPage(items: upcoming, hasMore: false);
  }

  @override
  Future<ItemPage<OpenAgreedReturn>> listOpen({String? cursor}) async {
    return ItemPage(items: open, hasMore: false);
  }

  @override
  Future<ReturnCommitment> create({
    required String messageRequestId,
    required DateTime expectedAt,
    required String idempotencyKey,
  }) async {
    createCalls += 1;
    lastExpectedAt = expectedAt;
    final created = _commitment(
      id: 'rc-new',
      expectedAt: expectedAt.toUtc(),
    );
    commitments = [created, ...commitments];
    return created;
  }

  @override
  Future<ReturnCommitment> update({
    required String id,
    required DateTime expectedAt,
    required DateTime updatedAt,
    required String idempotencyKey,
  }) async {
    updateCalls += 1;
    if (updateError != null) {
      throw updateError!;
    }
    lastExpectedAt = expectedAt;
    final updated = _commitment(id: id, expectedAt: expectedAt.toUtc());
    commitments = [
      for (final row in commitments) row.id == id ? updated : row,
    ];
    return updated;
  }

  @override
  Future<ReturnCommitment> arrive({
    required String id,
    required DateTime visitedAt,
    required String idempotencyKey,
    String? serviceId,
    String? amount,
  }) async {
    arriveCalls += 1;
    lastArriveId = id;
    lastVisitedAt = visitedAt;
    lastSaleAmount = amount;
    if (arriveError != null) {
      throw arriveError!;
    }
    return _commitment(
      id: id,
      expectedAt: DateTime.utc(2026, 9, 16, 12, 30),
      actualVisitId: 'v-arrived',
      backed: CommitmentBackedReturn(
        associationKind: 'COMMITMENT_BACKED',
        actualVisitId: 'v-arrived',
        visitedAt: visitedAt.toUtc(),
        associatedRevenue: AssociatedRevenue(
          recorded: amount != null,
          currency: 'IRR',
          amount: amount,
        ),
      ),
    );
  }
}

class FakeCustomerRepo extends CustomerRepository {
  FakeCustomerRepo() : super(_client());

  @override
  Future<Customer> getById(String id) async => _customer();

  @override
  Future<ItemPage<CustomerActivityItem>> listActivity(
    String customerId, {
    String? cursor,
  }) async {
    return const ItemPage(items: [], hasMore: false);
  }
}

class FakeSalonRepo extends SalonRepository {
  FakeSalonRepo() : super(_client());

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

class FakeServiceRepo extends ServiceRepository {
  FakeServiceRepo() : super(_client());

  @override
  Future<ItemPage<SalonService>> list({
    bool includeInactive = false,
    String? cursor,
  }) async {
    return const ItemPage(items: [], hasMore: false);
  }
}

class FakeIntelligenceRepo extends IntelligenceRepository {
  FakeIntelligenceRepo() : super(_client());

  @override
  Future<CustomerIntelligence> forCustomer(String customerId) async {
    return CustomerIntelligence.fromJson({
      'customerId': 'c1',
      'firstName': 'Sara',
      'lastName': 'Ahmadi',
      'status': 'ACTIVE',
      'explanation': 'No completed visits recorded yet.',
      'behavior': {
        'visitCount': 0,
        'daysSinceLastVisit': 0,
        'averageReturnIntervalDays': 35,
        'expectedReturnIntervalDays': 35,
      },
      'signals': <String>[],
      'opportunities': <Map<String, dynamic>>[],
    });
  }
}

class FakeActionRepo extends ActionRepository {
  FakeActionRepo() : super(_client());

  @override
  Future<ItemPage<OpportunityAction>> listForCustomer(
    String customerId, {
    String? status,
    String? cursor,
  }) async {
    return const ItemPage(items: [], hasMore: false);
  }
}

class _OwnerAuth extends AuthController {
  @override
  AuthState build() {
    return const AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(id: 'u1', tenantId: 't1', role: 'OWNER', name: 'Leila'),
    );
  }
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

// ignore: strict_top_level_inference
_detailOverrides({
  required FakeMessageRepo messages,
  required FakeReturnCommitmentRepo commitments,
  required FakeVisitRepo visits,
  AuthController Function()? auth,
}) {
  return [
    customerRepositoryProvider.overrideWithValue(FakeCustomerRepo()),
    intelligenceRepositoryProvider.overrideWithValue(FakeIntelligenceRepo()),
    actionRepositoryProvider.overrideWithValue(FakeActionRepo()),
    visitRepositoryProvider.overrideWithValue(visits),
    messageRepositoryProvider.overrideWithValue(messages),
    returnCommitmentRepositoryProvider.overrideWithValue(commitments),
    authControllerProvider.overrideWith(auth ?? _OwnerAuth.new),
  ];
}

void main() {
  test('SENT without commitment can record; queued/failed/duplicate cannot', () {
    expect(canRecordReturnCommitment(_message(id: 'a', status: 'SENT')), isTrue);
    expect(canRecordReturnCommitment(_message(id: 'b', status: 'QUEUED')), isFalse);
    expect(canRecordReturnCommitment(_message(id: 'c', status: 'FAILED')), isFalse);
    expect(
      canRecordReturnCommitment(
        _message(
          id: 'd',
          status: 'SENT',
          commitment: ReturnCommitmentSummary(
            id: 'rc1',
            expectedAt: DateTime.utc(2026, 9, 20),
          ),
        ),
      ),
      isFalse,
    );
  });

  test('Jalali local clock converts to UTC ISO for the API', () {
    final local = jalaliWithTimeToLocal(jalaliFromLocal(DateTime(2026, 9, 28, 16, 30)), 16, 30);
    expect(local.toUtc().toIso8601String(), contains('T'));
    expect(DateTime.parse(local.toUtc().toIso8601String()).isUtc, isTrue);
  });

  test('classifier hides OBSERVED for a Visit that already has COMMITMENT_BACKED', () {
    final commitments = [
      _commitment(
        id: 'rc1',
        expectedAt: DateTime.utc(2026, 9, 16, 12, 30),
        actualVisitId: 'v1',
      ),
    ];
    final observed = [
      ObservedReturn(
        associationKind: 'OBSERVED',
        requestId: 'm1',
        visitId: 'v1',
        visitedAt: DateTime.utc(2026, 9, 16, 12, 52),
        associatedRevenue: const AssociatedRevenue(recorded: true, currency: 'IRR', amount: '10.00'),
      ),
      ObservedReturn(
        associationKind: 'OBSERVED',
        requestId: 'm2',
        visitId: 'v2',
        visitedAt: DateTime.utc(2026, 9, 17),
        associatedRevenue: const AssociatedRevenue(recorded: false, currency: 'IRR'),
      ),
    ];
    final visible = observedReturnsWithoutCommitmentWins(
      observed: observed,
      commitments: commitments,
    );
    expect(visible.map((row) => row.visitId), ['v2']);
    expect(associatedRevenueCopy(observed.first.associatedRevenue), contains('۱۰.۰۰'));
    expect(
      associatedRevenueCopy(const AssociatedRevenue(recorded: false, currency: 'IRR')),
      AppStrings.recoveryRevenueNone,
    );
  });

  testWidgets('customer detail shows SENT action and hides ineligible messages', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _detailOverrides(
          messages: FakeMessageRepo([
            _message(id: 'queued', status: 'QUEUED'),
            _message(id: 'failed', status: 'FAILED'),
            _message(
              id: 'has-rc',
              status: 'SENT',
              commitment: ReturnCommitmentSummary(
                id: 'rc-old',
                expectedAt: DateTime.utc(2026, 9, 20, 12),
              ),
            ),
            _message(id: 'sent', status: 'SENT', opportunityType: 'REACTIVATION'),
          ]),
          commitments: FakeReturnCommitmentRepo(),
          visits: FakeVisitRepo(),
        ),
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recordAgreedReturn), findsOneWidget);
    expect(find.text(AppStrings.customerMessagesTitle), findsOneWidget);
    expect(find.text(AppStrings.agreedReturnsTitle), findsNothing);
  });

  testWidgets('create form submits UTC and double-tap does not duplicate', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final repo = FakeReturnCommitmentRepo();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [returnCommitmentRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          home: Scaffold(
            body: ReturnCommitmentFormSheet(
              customerId: 'c1',
              messageRequestId: 'sent',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text(AppStrings.saveAgreedReturn));
    await tester.tap(find.text(AppStrings.saveAgreedReturn));
    await tester.tap(find.text(AppStrings.saveAgreedReturn), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(repo.createCalls, 1);
    expect(repo.lastExpectedAt, isNotNull);
  });

  testWidgets('open commitment is editable; fulfilled is not', (tester) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final open = _commitment(
      id: 'rc-open',
      expectedAt: DateTime.now().add(const Duration(days: 2)),
    );
    final done = _commitment(
      id: 'rc-done',
      expectedAt: DateTime.utc(2026, 9, 1, 12),
      actualVisitId: 'v1',
      backed: CommitmentBackedReturn(
        associationKind: 'COMMITMENT_BACKED',
        actualVisitId: 'v1',
        visitedAt: DateTime.utc(2026, 9, 1, 12, 20),
        associatedRevenue: const AssociatedRevenue(
          recorded: false,
          currency: 'IRR',
        ),
      ),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: _detailOverrides(
          messages: FakeMessageRepo(const []),
          commitments: FakeReturnCommitmentRepo(commitments: [open, done]),
          visits: FakeVisitRepo(),
        ),
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.editAgreedReturn), findsOneWidget);
    expect(find.text(AppStrings.markArrived), findsOneWidget);
    expect(find.text(AppStrings.recoveryCommitmentBackedTitle), findsWidgets);
    expect(find.text(AppStrings.recoveryRevenueNone), findsOneWidget);
  });

  testWidgets('operationally settled unlinked commitment stays historical and hides arrive', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final settled = _commitment(
      id: 'rc-settled',
      expectedAt: DateTime.now().add(const Duration(days: 2)),
      operationallyOpen: false,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: _detailOverrides(
          messages: FakeMessageRepo(const []),
          commitments: FakeReturnCommitmentRepo(commitments: [settled]),
          visits: FakeVisitRepo(),
        ),
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.agreedReturnsTitle), findsOneWidget);
    expect(find.text(AppStrings.operationallySettledUnlinked), findsOneWidget);
    expect(find.text(AppStrings.markArrived), findsNothing);
    expect(find.text(AppStrings.editAgreedReturn), findsNothing);
    expect(find.text(AppStrings.recoveryCommitmentBackedTitle), findsNothing);
  });

  testWidgets('stale edit 409 keeps the form from claiming success', (tester) async {
    final repo = FakeReturnCommitmentRepo(
      updateError: const ApiException(
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Return commitment was updated by another request',
      ),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [returnCommitmentRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp(
          home: Scaffold(
            body: ReturnCommitmentFormSheet(
              customerId: 'c1',
              existing: _commitment(
                id: 'rc1',
                expectedAt: DateTime.now().add(const Duration(days: 1)),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.saveAgreedReturn));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.staleCommitmentEdit), findsWidgets);
    expect(find.text(AppStrings.saveAgreedReturn), findsOneWidget);
  });

  testWidgets('past expectedAt without visit uses factual overdue copy', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _detailOverrides(
          messages: FakeMessageRepo(const []),
          commitments: FakeReturnCommitmentRepo(
            commitments: [
              _commitment(
                id: 'rc-past',
                expectedAt: DateTime.utc(2026, 1, 1, 12),
              ),
            ],
          ),
          visits: FakeVisitRepo(),
        ),
        child: const MaterialApp(home: CustomerDetailScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.agreedTimePast), findsOneWidget);
    expect(find.text(AppStrings.agreedReturnsTitle), findsOneWidget);
    expect(find.text(AppStrings.visitHistory), findsOneWidget);
  });

  testWidgets('arrival uses commitment arrive API not POST /visits', (
    tester,
  ) async {
    final visits = FakeVisitRepo();
    final commitments = FakeReturnCommitmentRepo();
    final open = _commitment(
      id: 'rc-arrive',
      expectedAt: DateTime.utc(2026, 9, 16, 12, 30),
    );
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          returnCommitmentRepositoryProvider.overrideWithValue(commitments),
          visitRepositoryProvider.overrideWithValue(visits),
          serviceRepositoryProvider.overrideWithValue(FakeServiceRepo()),
          authControllerProvider.overrideWith(_OwnerAuth.new),
        ],
        child: MaterialApp.router(
          routerConfig: GoRouter(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, _) =>
                    RecordVisitScreen(customerId: 'c1', commitment: open),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.arrivalHint), findsOneWidget);
    final save = find.byKey(const Key('save-visit'));
    await tester.ensureVisible(save.first);
    await tester.tap(save.first);
    await tester.pumpAndSettle();
    expect(visits.recordCalls, 0);
    expect(commitments.arriveCalls, 1);
    expect(commitments.lastArriveId, 'rc-arrive');
    expect(commitments.lastVisitedAt, isNotNull);
  });

  testWidgets('stale arrive 409 shows review copy and does not claim success', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final commitments = FakeReturnCommitmentRepo(
      arriveError: const ApiException(
        statusCode: 409,
        code: 'RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED',
        message:
            'A visit after this follow-up is already recorded. Review the existing visit instead of creating another one.',
      ),
    );
    final open = _commitment(
      id: 'rc-stale',
      expectedAt: DateTime.now().add(const Duration(days: 1)),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          returnCommitmentRepositoryProvider.overrideWithValue(commitments),
          serviceRepositoryProvider.overrideWithValue(FakeServiceRepo()),
          authControllerProvider.overrideWith(_OwnerAuth.new),
        ],
        child: MaterialApp.router(
          routerConfig: GoRouter(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, _) =>
                    RecordVisitScreen(customerId: 'c1', commitment: open),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final save = find.byKey(const Key('save-visit'));
    await tester.ensureVisible(save.first);
    await tester.tap(save.first);
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.arrivalVisitReviewRequired), findsOneWidget);
    expect(find.byKey(const Key('save-visit')), findsWidgets);
    expect(commitments.arriveCalls, 1);
  });

  testWidgets('staff arrival form has no sale fields', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StaffAuth.new),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeReturnCommitmentRepo(),
          ),
        ],
        child: MaterialApp(
          home: RecordVisitScreen(
            customerId: 'c1',
            commitment: _commitment(
              id: 'rc1',
              expectedAt: DateTime.utc(2026, 9, 16, 12),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.amountReceived), findsNothing);
  });

  testWidgets('composer still sends when upcoming context fails', (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final messages = FakeMessageRepo(const []);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(FakeCustomerRepo()),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepo()),
          messageRepositoryProvider.overrideWithValue(messages),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeReturnCommitmentRepo(upcomingError: const NetworkException()),
          ),
        ],
        child: const MaterialApp(
          home: Scaffold(body: OutreachMessageComposer(customerId: 'c1')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.upcomingCommitmentsTitle), findsNothing);
    expect(find.text(AppStrings.sendMessageAction), findsWidgets);
    expect(find.text(AppStrings.upcomingCommitmentsHint), findsOneWidget);
  });

  testWidgets('composer empty upcoming is informational only', (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(FakeCustomerRepo()),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepo()),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepo(const [])),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeReturnCommitmentRepo(),
          ),
        ],
        child: const MaterialApp(
          home: Scaffold(body: OutreachMessageComposer(customerId: 'c1')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.upcomingCommitmentsEmpty), findsOneWidget);
    expect(find.text(AppStrings.sendMessageAction), findsWidgets);
  });

  testWidgets('composer renders upcoming commitments without availability copy', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          customerRepositoryProvider.overrideWithValue(FakeCustomerRepo()),
          salonRepositoryProvider.overrideWithValue(FakeSalonRepo()),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepo(const [])),
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeReturnCommitmentRepo(
              upcoming: [
                UpcomingReturnCommitment(
                  id: 'u1',
                  customerId: 'c2',
                  customerName: 'مریم احمدی',
                  expectedAt: DateTime.now().add(const Duration(hours: 2)),
                ),
              ],
            ),
          ),
        ],
        child: const MaterialApp(
          home: Scaffold(body: OutreachMessageComposer(customerId: 'c1')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.upcomingCommitmentsTitle), findsOneWidget);
    expect(find.textContaining('مریم احمدی'), findsOneWidget);
    expect(find.textContaining('پر است'), findsNothing);
    expect(find.textContaining('آزاد'), findsNothing);
  });

  testWidgets('today open agreed-return list shows name phone and call', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    var called = '';
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          returnCommitmentRepositoryProvider.overrideWithValue(
            FakeReturnCommitmentRepo(
              open: [
                OpenAgreedReturn(
                  id: 'o1',
                  customerId: 'c1',
                  customerName: 'سارا احمدی',
                  customerPhone: '09121111111',
                  expectedAt: DateTime.now().subtract(const Duration(hours: 2)),
                  overdue: true,
                  recordedBySupport: true,
                ),
              ],
            ),
          ),
          phoneLauncherProvider.overrideWithValue((phone) async {
            called = phone;
            return true;
          }),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: OpenAgreedReturnsSection(
              items: [
                OpenAgreedReturn(
                  id: 'o1',
                  customerId: 'c1',
                  customerName: 'سارا احمدی',
                  customerPhone: '09121111111',
                  expectedAt: DateTime.utc(2026, 9, 19, 10),
                  overdue: true,
                  recordedBySupport: true,
                ),
              ],
              loading: false,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.openAgreedReturnsTitle), findsOneWidget);
    expect(find.text('سارا احمدی'), findsOneWidget);
    expect(find.text('09121111111'), findsOneWidget);
    expect(find.text(AppStrings.recordedBySupport), findsOneWidget);
    expect(find.text(AppStrings.agreedTimePast), findsOneWidget);
    await tester.tap(find.text(AppStrings.callCustomer));
    await tester.pump();
    expect(called, '09121111111');
  });

  test('error copy stays product language', () {
    expect(
      localizeUserFacingMessage(
        'A return commitment already exists for this outreach',
      ),
      AppStrings.commitmentAlreadyExists,
    );
    expect(
      localizeUserFacingMessage(
        'Return commitment is already linked to an actual visit',
      ),
      AppStrings.arrivalAlreadyRecorded,
    );
  });
}
