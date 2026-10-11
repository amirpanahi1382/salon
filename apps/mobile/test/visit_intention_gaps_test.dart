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
import 'package:salon_mobile/features/customers/customer_screens.dart';
import 'package:salon_mobile/features/followups/follow_ups_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore());
}

VisitIntention _intention({
  required String id,
  required bool open,
  String precision = 'UNKNOWN',
}) {
  return VisitIntention(
    id: id,
    subject: 'CUSTOMER',
    customerId: 'c1',
    reportedBy: 'SALON_USER',
    reportChannel: 'SALON_STAFF',
    reportedAt: DateTime.utc(2026, 10, 1),
    timePrecision: precision,
    timeKnown: precision == 'INSTANT',
    operationallyOpen: open,
    updatedAt: DateTime.utc(2026, 10, 1),
    linkedVisitId: open ? null : 'visit-old',
  );
}

Customer _customer(String id, String first, String phone) {
  return Customer(
    id: id,
    firstName: first,
    lastName: 'تست',
    phoneNumber: phone,
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  );
}

class _Intentions extends VisitIntentionRepository {
  _Intentions({this.page, this.onCreate, this.onAdmin}) : super(_client());

  final ItemPage<VisitIntention>? page;
  final Future<VisitIntention> Function(String key, Map<String, dynamic> time)? onCreate;
  final Future<VisitIntention> Function({
    required String customerId,
    required String key,
    required Map<String, dynamic> time,
    String? sourceMessageRequestId,
  })? onAdmin;
  final List<String> keys = [];

  @override
  Future<ItemPage<VisitIntention>> listForCustomer(String customerId, {String? cursor}) async {
    return page ?? const ItemPage(items: [], hasMore: false);
  }

  @override
  Future<VisitIntention> createForCustomer({
    required String customerId,
    required Map<String, dynamic> time,
    required String idempotencyKey,
    String? sourceMessageRequestId,
  }) {
    keys.add(idempotencyKey);
    return onCreate!(idempotencyKey, time);
  }

  @override
  Future<VisitIntention> createForVipRequest({
    required String vipRequestId,
    required Map<String, dynamic> time,
    required String idempotencyKey,
    String? disclosedDisplayName,
    String? disclosedPhone,
  }) {
    keys.add(idempotencyKey);
    return onCreate!(idempotencyKey, time);
  }

  @override
  Future<VisitIntention> createAdminCustomer({
    required String customerId,
    required Map<String, dynamic> time,
    required String idempotencyKey,
    String? sourceMessageRequestId,
  }) {
    keys.add(idempotencyKey);
    return onAdmin!(
      customerId: customerId,
      key: idempotencyKey,
      time: time,
      sourceMessageRequestId: sourceMessageRequestId,
    );
  }
}

class _Customers extends CustomerRepository {
  _Customers(this.pages) : super(_client());

  final Map<String, Future<ItemPage<Customer>>> pages;
  final List<String> calls = [];

  @override
  Future<ItemPage<Customer>> list({String? query, String? cursor}) {
    final key = '${query?.trim() ?? ''}|${cursor ?? ''}';
    calls.add(key);
    return pages[key] ?? Future.value(const ItemPage(items: [], hasMore: false));
  }
}

class _AdminMessages extends AdminMessageRepository {
  _AdminMessages(this.item) : super(_client());

  final AdminQueueItem item;

  @override
  Future<AdminQueueItem> getById(String id) async => item;
}

AdminQueueItem _queue({
  required String status,
  String customerId = 'c1',
  String? vipRequestId,
  String? deliveryStatus,
}) {
  return AdminQueueItem(
    id: 'msg-1',
    salonId: 's1',
    salonName: 'گل',
    customerId: customerId,
    customerName: 'سارا',
    customerPhone: '09121111111',
    messageText: 'سلام',
    requestedAt: DateTime.utc(2026, 10, 1),
    status: status,
    deliveryStatus: deliveryStatus,
    attempts: 0,
    providerReady: true,
    vipRequestId: vipRequestId,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('empty customer intention history does not reuse the follow-up empty copy', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(_Intentions()),
        ],
        child: const MaterialApp(home: CustomerIntentionsScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.customerVisitIntentionsEmpty), findsOneWidget);
    expect(find.text(AppStrings.followUpsCustomersEmpty), findsNothing);
    expect(find.text(AppStrings.followUpsVipEmpty), findsNothing);
    expect(find.text(AppStrings.markVisited), findsNothing);
  });

  testWidgets('customer intention history shows open and settled entries', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(
            _Intentions(
              page: ItemPage(
                items: [
                  _intention(id: 'open-1', open: true),
                  _intention(id: 'closed-1', open: false),
                ],
                hasMore: false,
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: CustomerIntentionsScreen(customerId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.customerVisitIntentionsEmpty), findsNothing);
    expect(find.text(AppStrings.visitIntentionTitle), findsOneWidget);
    expect(find.text(AppStrings.recordedVisitLabel), findsOneWidget);
    expect(find.text(AppStrings.visitIntentionUnknownTime), findsNWidgets(2));
    expect(find.byKey(const ValueKey('arrive-open-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('arrive-closed-1')), findsNothing);
    expect(find.text(AppStrings.markVisited), findsOneWidget);
  });

  testWidgets('an open intention row carries its id into record visit', (tester) async {
    String? seenCustomer;
    String? seenIntention;
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const CustomerIntentionsScreen(customerId: 'c1'),
        ),
        GoRoute(
          path: '/customers/:id/record-visit',
          builder: (context, state) {
            final extra = state.extra;
            final link = extra is RecordVisitLink ? extra : null;
            seenCustomer = state.pathParameters['id'];
            seenIntention = link?.visitIntentionId;
            return Text('linked ${link?.visitIntentionId ?? 'none'}');
          },
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          visitIntentionRepositoryProvider.overrideWithValue(
            _Intentions(
              page: ItemPage(
                items: [
                  _intention(id: 'open-1', open: true),
                  _intention(id: 'closed-1', open: false),
                ],
                hasMore: false,
              ),
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recordVisit), findsNothing);
    expect(find.text(AppStrings.markVisited), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('arrive-open-1')));
    await tester.pumpAndSettle();
    expect(seenCustomer, 'c1');
    expect(seenIntention, 'open-1');
    expect(find.text('linked open-1'), findsOneWidget);
  });

  testWidgets('record visit for an intention does not require a return commitment', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: RecordVisitScreen(customerId: 'c1', visitIntentionId: 'open-1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text(AppStrings.markArrived), findsWidgets);
    expect(find.textContaining(AppStrings.agreedAtLabel), findsNothing);
  });

  testWidgets('an unchanged intention save retries with the original key', (tester) async {
    final saved = _intention(id: 'saved', open: true);
    var calls = 0;
    late final _Intentions repo;
    repo = _Intentions(
      onCreate: (key, time) async {
        calls += 1;
        if (calls == 1) throw const NetworkException();
        if (calls == 2 && repo.keys.toSet().length != 1) {
          throw const ApiException(
            statusCode: 409,
            code: 'CONFLICT',
            message: 'An open visit intention already exists for this customer',
          );
        }
        return saved;
      },
    );
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => Scaffold(
            body: TextButton(
              onPressed: () => context.push('/form'),
              child: const Text('open-form'),
            ),
          ),
        ),
        GoRoute(
          path: '/form',
          builder: (context, state) => const VisitIntentionFormScreen(targetId: 'c1'),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [visitIntentionRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('open-form'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('save-visit-intention')));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.networkError), findsOneWidget);
    expect(find.text('An open visit intention already exists for this customer'), findsNothing);
    await tester.tap(find.byKey(const Key('save-visit-intention')));
    await tester.pumpAndSettle();
    expect(find.text('open-form'), findsOneWidget);
    expect(repo.keys, hasLength(2));
    expect(repo.keys.first, repo.keys.last);
    expect(find.text('An open visit intention already exists for this customer'), findsNothing);
  });

  testWidgets('open-intention conflict is Persian and other conflicts stay distinct', (tester) async {
    var calls = 0;
    final repo = _Intentions(
      onCreate: (key, time) async {
        calls += 1;
        if (calls == 1) {
          throw const ApiException(
            statusCode: 409,
            code: 'CONFLICT',
            message: 'An open visit intention already exists for this customer',
          );
        }
        throw const ApiException(
          statusCode: 409,
          code: 'CONFLICT',
          message: 'A conflicting record already exists',
        );
      },
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [visitIntentionRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: VisitIntentionFormScreen(targetId: 'c1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('save-visit-intention')));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.openCustomerVisitIntentionExists), findsOneWidget);
    expect(find.text('An open visit intention already exists for this customer'), findsNothing);
    expect(find.text('A conflicting record already exists'), findsNothing);
    await tester.tap(find.byKey(const Key('save-visit-intention')));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.openCustomerVisitIntentionExists), findsNothing);
    expect(find.text('A conflicting record already exists'), findsOneWidget);
    expect(find.text(AppStrings.genericError), findsNothing);
  });

  testWidgets('VIP arrival can select a later page and a newly created customer', (tester) async {
    String? chosenCustomer;
    String? chosenIntention;
    final created = _customer('created-9', 'تازه', '09129990000');
    final repo = _Customers({
      '|': Future.value(ItemPage(
        items: [_customer('page-1', 'اول', '09120000001')],
        hasMore: true,
        nextCursor: 'c2',
      )),
      '|c2': Future.value(ItemPage(
        items: [_customer('page-2', 'بعدی', '09120000002')],
        hasMore: false,
      )),
    });
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const VipArrivalCustomerScreen(intentionId: 'vip-i'),
        ),
        GoRoute(
          path: '/customers/new',
          builder: (context, state) => Scaffold(
            body: TextButton(
              onPressed: () => context.pop(created),
              child: const Text('finish-create'),
            ),
          ),
        ),
        GoRoute(
          path: '/customers/:id/record-visit',
          builder: (context, state) {
            final extra = state.extra;
            final link = extra is RecordVisitLink ? extra : null;
            chosenCustomer = state.pathParameters['id'];
            chosenIntention = link?.visitIntentionId;
            return Text('recording ${state.pathParameters['id']} ${link?.visitIntentionId}');
          },
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
    expect(find.text('اول تست'), findsOneWidget);
    expect(find.text('بعدی تست'), findsNothing);
    await tester.tap(find.text(AppStrings.loadMore));
    await tester.pumpAndSettle();
    expect(find.text('بعدی تست'), findsOneWidget);
    await tester.tap(find.text('بعدی تست'));
    await tester.pumpAndSettle();
    expect(chosenCustomer, 'page-2');
    expect(chosenIntention, 'vip-i');
    expect(find.text('recording page-2 vip-i'), findsOneWidget);
    router.pop(false);
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.addCustomer));
    await tester.pumpAndSettle();
    await tester.tap(find.text('finish-create'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.createdCustomerReady), findsOneWidget);
    expect(find.text('تازه تست'), findsOneWidget);
    await tester.tap(find.text('تازه تست'));
    await tester.pumpAndSettle();
    expect(chosenCustomer, 'created-9');
    expect(chosenIntention, 'vip-i');
  });

  testWidgets('VIP arrival distinguishes an empty salon from a search miss and ignores a stale page', (tester) async {
    final oldResponse = Completer<ItemPage<Customer>>();
    final newResponse = Completer<ItemPage<Customer>>();
    final repo = _Customers({
      '|': Future.value(const ItemPage(items: [], hasMore: false)),
      'هیچ|': Future.value(const ItemPage(items: [], hasMore: false)),
      'قدیمی|': oldResponse.future,
      'جدید|': newResponse.future,
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [customerRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: VipArrivalCustomerScreen(intentionId: 'vip-i')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.noCustomers), findsOneWidget);
    expect(find.text(AppStrings.noMatchingCustomers), findsNothing);

    await tester.enterText(find.byType(TextField), 'هیچ');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.noMatchingCustomers), findsOneWidget);
    expect(find.text(AppStrings.noCustomers), findsNothing);

    await tester.enterText(find.byType(TextField), 'قدیمی');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'جدید');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    newResponse.complete(ItemPage(
      items: [_customer('new', 'نتیجهجدید', '09120000003')],
      hasMore: false,
    ));
    await tester.pumpAndSettle();
    oldResponse.complete(ItemPage(
      items: [_customer('old', 'نتیجهقدیمی', '09120000004')],
      hasMore: false,
    ));
    await tester.pumpAndSettle();
    expect(find.text('نتیجهجدید تست'), findsOneWidget);
    expect(find.text('نتیجهقدیمی تست'), findsNothing);
  });

  testWidgets('queued admin customer message can record an intention without a sent commitment', (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final saved = _intention(id: 'admin-saved', open: true);
    var calls = 0;
    String? source;
    late final _Intentions repo;
    repo = _Intentions(
      onAdmin: ({
        required String customerId,
        required String key,
        required Map<String, dynamic> time,
        String? sourceMessageRequestId,
      }) async {
        calls += 1;
        source = sourceMessageRequestId;
        if (calls == 1) throw const NetworkException();
        if (repo.keys.toSet().length != 1) {
          throw const ApiException(
            statusCode: 409,
            code: 'CONFLICT',
            message: 'An open visit intention already exists for this customer',
          );
        }
        expect(customerId, 'c1');
        expect(time['precision'], 'UNKNOWN');
        return saved;
      },
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(_AdminMessages(_queue(status: 'QUEUED'))),
          visitIntentionRepositoryProvider.overrideWithValue(repo),
        ],
        child: const MaterialApp(home: AdminMessageDetailSheet(itemId: 'msg-1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recordAgreedReturn), findsNothing);
    expect(find.text(AppStrings.recordCustomerIntentionToldToAdmin), findsOneWidget);
    expect(find.text(AppStrings.customerIntentionNotReturnCommitment), findsOneWidget);
    await tester.tap(find.text(AppStrings.recordCustomerIntentionToldToAdmin));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.timeUnknown));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.networkError), findsOneWidget);
    await tester.tap(find.text(AppStrings.recordCustomerIntentionToldToAdmin));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.timeUnknown));
    await tester.pumpAndSettle();
    expect(source, 'msg-1');
    expect(repo.keys, hasLength(2));
    expect(repo.keys.first, repo.keys.last);
    expect(find.textContaining('سارا'), findsOneWidget);
    expect(find.text('An open visit intention already exists for this customer'), findsNothing);
  });

  testWidgets('sent admin customer message keeps return commitment distinct from visit intention', (tester) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            _AdminMessages(_queue(status: 'SENT', deliveryStatus: 'SENT')),
          ),
        ],
        child: const MaterialApp(home: AdminMessageDetailSheet(itemId: 'msg-1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recordAgreedReturn), findsOneWidget);
    expect(find.text(AppStrings.recordCustomerIntentionToldToAdmin), findsOneWidget);
  });

  testWidgets('admin VIP message does not offer a customer intention', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            _AdminMessages(_queue(status: 'QUEUED', customerId: '', vipRequestId: 'vip-1')),
          ),
        ],
        child: const MaterialApp(home: AdminMessageDetailSheet(itemId: 'msg-1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recordCustomerIntentionToldToAdmin), findsNothing);
    expect(find.text(AppStrings.recordAgreedReturn), findsNothing);
  });
}
