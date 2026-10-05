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
import 'package:salon_mobile/features/admin/admin_vip_outreach_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

AdminVipOutreachFolder _folder({
  required String salonId,
  required String name,
  int requests = 1,
  int pending = 0,
  int sent = 0,
  int failed = 0,
}) {
  return AdminVipOutreachFolder(
    salonId: salonId,
    salonName: name,
    requestCount: requests,
    recipientCount: pending + sent + failed,
    pendingMessageCount: pending,
    sentMessageCount: sent,
    failedMessageCount: failed,
  );
}

AdminVipOutreachRequest _request({
  required String id,
  required String salonId,
  String listName = 'VIP-01-01',
  String? regionCode = '01',
  String? regionName = 'مرکز؛ حسن‌آباد، بازار و انقلاب',
  int sent = 0,
  int pending = 30,
  String status = 'SUBMITTED',
}) {
  return AdminVipOutreachRequest(
    id: id,
    salonId: salonId,
    salonName: 'Salon A',
    listId: 'list-$id',
    listName: listName,
    regionCode: regionCode,
    regionName: regionName,
    requestedCount: 30,
    geographicRange: regionName ?? 'ونک',
    status: status,
    recipientCount: pending + sent,
    notYetQueuedCount: pending,
    queuedCount: 0,
    inPipelineCount: 0,
    sentCount: sent,
    failedCount: 0,
    sampleWorkCount: 1,
    canDispatchManual: status == 'SUBMITTED',
    displayTitle: 'Salon A — منطقه ${regionCode ?? '—'} — ${pending + sent} مخاطب',
  );
}

class _FakeVipRepository extends VipRepository {
  _FakeVipRepository({
    this.folders = const [],
    this.requestsBySalon = const {},
    this.recipientsByRequest = const {},
    this.foldersError,
    this.queryResponses = const {},
  }) : super(_client());

  final List<AdminVipOutreachFolder> folders;
  final Map<String, List<AdminVipOutreachRequest>> requestsBySalon;
  final Map<String, List<AdminVipOutreachRecipient>> recipientsByRequest;
  final Object? foldersError;
  final Map<String, Future<ItemPage<AdminVipOutreachFolder>>> queryResponses;
  final List<String> folderQueries = [];
  final List<String> salonLoads = [];

  @override
  Future<AdminVipInventoryPage> adminLists({
    String? cursor,
    String? catalogMembership,
  }) async {
    return const AdminVipInventoryPage(
      items: [],
      hasMore: false,
      listCount: 0,
      contactRowCount: 0,
      recordedContactCount: 0,
    );
  }

  @override
  Future<ItemPage<AdminSalonSummary>> adminSalons({String? cursor, String? q}) async {
    return const ItemPage(items: [], hasMore: false);
  }

  @override
  Future<ItemPage<AdminVipOutreachFolder>> adminOutreachSalons({
    String? cursor,
    String? query,
  }) async {
    folderQueries.add(query ?? '');
    final q = query?.trim() ?? '';
    final controlled = queryResponses[q];
    if (controlled != null) {
      return controlled;
    }
    if (foldersError != null) {
      throw foldersError!;
    }
    return ItemPage(
      items: q.isEmpty
          ? folders
          : folders.where((row) => row.salonName.contains(q)).toList(),
      hasMore: false,
    );
  }

  @override
  Future<AdminVipOutreachSalonPage> adminOutreachSalon(
    String salonId, {
    String? cursor,
  }) async {
    salonLoads.add(salonId);
    return AdminVipOutreachSalonPage(
      salonId: salonId,
      salonName: folders
          .firstWhere(
            (row) => row.salonId == salonId,
            orElse: () => _folder(salonId: salonId, name: 'Salon'),
          )
          .salonName,
      page: ItemPage(items: requestsBySalon[salonId] ?? const [], hasMore: false),
    );
  }

  @override
  Future<AdminVipOutreachRequestPage> adminOutreachRequest(
    String requestId, {
    String? cursor,
  }) async {
    final request = requestsBySalon.values
        .expand((rows) => rows)
        .firstWhere((row) => row.id == requestId);
    return AdminVipOutreachRequestPage(
      request: request,
      page: ItemPage(
        items: recipientsByRequest[requestId] ?? const [],
        hasMore: false,
      ),
    );
  }
}

Future<void> _pumpAdmin(WidgetTester tester, _FakeVipRepository repo) async {
  tester.view.physicalSize = const Size(800, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [vipRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(home: AdminVipOutreachFoldersScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows one folder per salon with factual counts', (tester) async {
    final repo = _FakeVipRepository(
      folders: [
        _folder(salonId: 's1', name: 'Salon A', requests: 3, pending: 60, sent: 30),
        _folder(salonId: 's2', name: 'Salon B', requests: 1, pending: 10, failed: 5),
      ],
    );
    await _pumpAdmin(tester, repo);
    expect(find.text(AppStrings.adminVipMessagingTitle), findsWidgets);
    expect(find.text('Salon A'), findsOneWidget);
    expect(find.text('Salon B'), findsOneWidget);
    expect(find.textContaining('${AppStrings.vipOutreachRequests} 3'), findsOneWidget);
    expect(find.text(AppStrings.sentOfTotal(30, 90)), findsOneWidget);
    expect(find.textContaining('${AppStrings.vipOutreachFailed} 5'), findsOneWidget);
  });

  testWidgets('empty folders are not treated as an API error', (tester) async {
    await _pumpAdmin(tester, _FakeVipRepository());
    expect(find.text(AppStrings.vipOutreachEmptyTitle), findsWidgets);
  });

  testWidgets('folder load errors stay errors', (tester) async {
    await _pumpAdmin(
      tester,
      _FakeVipRepository(
        foldersError: const ApiException(
          statusCode: 500,
          code: 'INTERNAL',
          message: 'down',
        ),
      ),
    );
    expect(find.text(AppStrings.vipOutreachEmptyTitle), findsNothing);
    expect(find.text(AppStrings.retry), findsOneWidget);
  });

  testWidgets('VIP search shows a filtered empty state', (tester) async {
    await _pumpAdmin(
      tester,
      _FakeVipRepository(folders: [_folder(salonId: 's1', name: 'Salon A')]),
    );
    await tester.enterText(find.byType(TextField), 'وجود ندارد');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipOutreachFilteredEmptyTitle), findsOneWidget);
    expect(find.text(AppStrings.vipOutreachEmptyTitle), findsNothing);
  });

  testWidgets('a stale VIP search cannot overwrite a newer query', (tester) async {
    final oldResponse = Completer<ItemPage<AdminVipOutreachFolder>>();
    final newResponse = Completer<ItemPage<AdminVipOutreachFolder>>();
    final repo = _FakeVipRepository(
      folders: [_folder(salonId: 'initial', name: 'نتیجه اولیه')],
      queryResponses: {'قدیمی': oldResponse.future, 'جدید': newResponse.future},
    );
    await _pumpAdmin(tester, repo);
    await tester.enterText(find.byType(TextField), 'قدیمی');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'جدید');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    newResponse.complete(ItemPage(
      items: [_folder(salonId: 'new', name: 'نتیجه جدید')], hasMore: false,
    ));
    await tester.pumpAndSettle();
    oldResponse.complete(ItemPage(
      items: [_folder(salonId: 'old', name: 'نتیجه قدیمی')], hasMore: false,
    ));
    await tester.pumpAndSettle();
    expect(find.text('نتیجه جدید'), findsOneWidget);
    expect(find.text('نتیجه قدیمی'), findsNothing);
  });

  testWidgets('opening a salon folder shows only that salon’s requests', (tester) async {
    final repo = _FakeVipRepository(
      folders: [_folder(salonId: 's1', name: 'Salon A', requests: 2)],
      requestsBySalon: {
        's1': [
          _request(id: 'r1', salonId: 's1', listName: 'VIP-01-01'),
          _request(id: 'r2', salonId: 's1', listName: 'VIP-02-01', regionCode: '02', regionName: 'شمال'),
        ],
        's2': [_request(id: 'r3', salonId: 's2', listName: 'VIP-03-01')],
      },
    );
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const AdminVipOutreachSalonScreen(salonId: 's1'),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(repo.salonLoads, ['s1']);
    expect(find.textContaining('منطقه 01'), findsOneWidget);
    expect(find.textContaining('منطقه 02'), findsOneWidget);
    expect(find.textContaining('VIP-03-01'), findsNothing);
    expect(find.textContaining(AppStrings.vipNeedsReview), findsWidgets);
  });

  testWidgets('request recipients show execution state and hide empty as queued', (tester) async {
    final repo = _FakeVipRepository(
      requestsBySalon: {
        's1': [_request(id: 'r1', salonId: 's1', pending: 0, sent: 1, status: 'MANUAL_QUEUED')],
      },
      recipientsByRequest: {
        'r1': [
          const AdminVipOutreachRecipient(
            id: 'c1',
            sortOrder: 0,
            displayName: 'مینا',
            phoneNumber: '09121111111',
            executionState: 'SENT',
            messageRequestId: 'm1',
          ),
          const AdminVipOutreachRecipient(
            id: 'c2',
            sortOrder: 1,
            phoneNumber: '09121111112',
            executionState: 'NOT_YET_QUEUED',
          ),
          const AdminVipOutreachRecipient(
            id: 'c3',
            sortOrder: 2,
            displayName: 'سارا',
            phoneNumber: '09121111113',
            executionState: 'QUEUED',
            messageRequestId: 'm2',
            canMarkManualSent: true,
            canCancel: true,
          ),
        ],
      },
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          home: AdminVipOutreachRequestScreen(requestId: 'r1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('مینا'), findsOneWidget);
    expect(find.text('09121111111'), findsOneWidget);
    expect(find.text(AppStrings.outreachStatusSent), findsOneWidget);
    expect(find.text(AppStrings.vipOutreachNotQueued), findsOneWidget);
    expect(find.text(AppStrings.vipUnnamedContact), findsOneWidget);
    expect(find.text(AppStrings.adminMarkRecipientSent), findsOneWidget);
    expect(find.text(AppStrings.adminRemoveFromQueue), findsOneWidget);
  });

  testWidgets('unqueued VIP recipients expose the request-level prerequisite', (tester) async {
    final repo = _FakeVipRepository(
      requestsBySalon: {
        's1': [_request(id: 'r1', salonId: 's1')],
      },
      recipientsByRequest: {
        'r1': const [
          AdminVipOutreachRecipient(
            id: 'c1', sortOrder: 0, phoneNumber: '09121111111',
            executionState: 'NOT_YET_QUEUED',
          ),
        ],
      },
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          home: AdminVipOutreachRequestScreen(requestId: 'r1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipOutreachDispatchPrerequisite), findsNWidgets(2));
    expect(find.text(AppStrings.vipOutreachDispatchAllManual), findsOneWidget);
    expect(find.text(AppStrings.adminMarkRecipientSent), findsNothing);
  });
}
