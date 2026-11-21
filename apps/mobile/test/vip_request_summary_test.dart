import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/vip/salon_vip_section.dart';
import 'package:salon_mobile/features/vip/vip_request_summary.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

VipRequest _request({
  required String id,
  required String status,
  required String listName,
  required int requestedCount,
  DateTime? createdAt,
  DateTime? submittedAt,
  List<VipSampleWork> sampleWorks = const [],
  VipRequestProgress? progress,
}) {
  return VipRequest(
    id: id,
    salonId: 'salon-a',
    salonName: 'سالن آزمایش',
    listId: 'list-$id',
    listName: listName,
    requestedCount: requestedCount,
    geographicRange: 'ونک',
    status: status,
    sampleWorks: sampleWorks,
    progress: progress,
    createdAt: createdAt,
    submittedAt: submittedAt,
  );
}

VipRequestHistoryItem _item(
  VipRequest request, {
  int manualRecordedSendCount = 0,
  int? reportedIntentionCount = 0,
  int? visitedRecipientCount = 0,
  String metricsAvailability = 'AVAILABLE',
}) {
  return VipRequestHistoryItem(
    request: request,
    recordedSendCount: manualRecordedSendCount,
    manualRecordedSendCount: manualRecordedSendCount,
    stillQueuedOrInProgressCount: 0,
    reportedIntentionCount: reportedIntentionCount,
    visitedRecipientCount: visitedRecipientCount,
    intentionRecipientCount: reportedIntentionCount,
    recipientDenominator: request.requestedCount,
    metricsAvailability: metricsAvailability,
  );
}

class _Repo extends VipRepository {
  _Repo({
    required this.capabilities,
    this.historyItems = const [],
    this.submitResult,
    this.updateHistoryOnSubmit = true,
  }) : super(_client());

  final List<VipCapability> capabilities;
  List<VipRequestHistoryItem> historyItems;
  final VipRequest? submitResult;
  final bool updateHistoryOnSubmit;
  int capabilityCalls = 0;
  int requestHistoryCalls = 0;
  int submitCalls = 0;

  @override
  Future<VipCapability> capability() async {
    final index = capabilityCalls < capabilities.length
        ? capabilityCalls
        : capabilities.length - 1;
    capabilityCalls += 1;
    return capabilities[index];
  }

  @override
  Future<VipRequestHistoryPage> requestHistory({String? cursor}) async {
    requestHistoryCalls += 1;
    return VipRequestHistoryPage(
      entitled: true,
      explanation: '',
      items: historyItems,
      hasMore: false,
    );
  }

  @override
  Future<List<VipRegion>> regions() async => const [];

  @override
  Future<VipRequest> submit(String requestId, String idempotencyKey) async {
    submitCalls += 1;
    final submitted = submitResult!;
    if (updateHistoryOnSubmit) {
      historyItems = [
        _item(submitted),
        for (final item in historyItems)
          if (item.request.id != submitted.id) item,
      ];
    }
    return submitted;
  }
}

Future<void> _pumpSalon(WidgetTester tester, _Repo repo) async {
  tester.view.physicalSize = const Size(800, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [vipRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(home: Scaffold(body: SalonVipSection())),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  final older72 = _request(
    id: 'vip-05-02',
    status: 'SUBMITTED',
    listName: 'VIP-05-02',
    requestedCount: 72,
    createdAt: DateTime.utc(2026, 11, 14, 11, 51, 37),
    submittedAt: DateTime.utc(2026, 11, 14, 12, 3, 36),
  );
  final older100 = _request(
    id: 'vip-06-01',
    status: 'MANUAL_QUEUED',
    listName: 'VIP-06-01',
    requestedCount: 100,
    createdAt: DateTime.utc(2026, 11, 8, 5, 22, 32),
    submittedAt: DateTime.utc(2026, 11, 8, 5, 22, 40),
  );
  final southeast = _request(
    id: 'vip-12-01',
    status: 'SUBMITTED',
    listName: 'VIP-12-01',
    requestedCount: 100,
    createdAt: DateTime.utc(2026, 11, 21, 10, 6, 59),
    submittedAt: DateTime.utc(2026, 11, 21, 10, 7, 6),
  );
  final cancelled = _request(
    id: 'vip-cancelled',
    status: 'CANCELLED',
    listName: 'VIP-08-01',
    requestedCount: 50,
    createdAt: DateTime.utc(2026, 11, 10, 8),
  );
  final tiedNewer = _request(
    id: 'z-new',
    status: 'SUBMITTED',
    listName: 'Tied-New',
    requestedCount: 30,
    createdAt: DateTime.utc(2026, 11, 18, 12),
    submittedAt: DateTime.utc(2026, 11, 18, 12),
  );
  final tiedOlderId = _request(
    id: 'a-old',
    status: 'SUBMITTED',
    listName: 'Tied-Old',
    requestedCount: 30,
    createdAt: DateTime.utc(2026, 11, 18, 12),
    submittedAt: DateTime.utc(2026, 11, 18, 12),
  );

  test('newest-to-oldest order uses createdAt then id', () {
    final items = orderedVipRequestHistory(
      page: [
        _item(older100),
        _item(cancelled),
        _item(older72),
        _item(southeast),
      ],
    );
    expect(
      items.map((item) => item.request.listName).toList(),
      ['VIP-12-01', 'VIP-05-02', 'VIP-08-01', 'VIP-06-01'],
    );
  });

  test('tied timestamps sort by id descending and keep cancelled in line', () {
    final items = orderedVipRequestHistory(
      page: [_item(tiedOlderId), _item(tiedNewer), _item(cancelled)],
    );
    expect(
      items.map((item) => item.request.listName).toList(),
      ['Tied-New', 'Tied-Old', 'VIP-08-01'],
    );
  });

  test('focused request is not duplicated when it is also on the history page', () {
    final items = orderedVipRequestHistory(
      page: [_item(southeast), _item(older72)],
      extra: southeast,
      hideRequestId: southeast.id,
    );
    expect(items.map((item) => item.request.id).toList(), ['vip-05-02']);
  });

  testWidgets('shared metric helpers match Opportunities zero-before-submit rules', (
    tester,
  ) async {
    final draft = _item(
      _request(
        id: 'draft',
        status: 'AWAITING_SAMPLE_WORK',
        listName: 'VIP-12-01',
        requestedCount: 100,
      ),
    );
    final submitted = _item(
      southeast,
      reportedIntentionCount: 4,
      manualRecordedSendCount: 2,
      visitedRecipientCount: 1,
    );
    final unavailable = _item(
      cancelled,
      reportedIntentionCount: null,
      visitedRecipientCount: null,
      metricsAvailability: 'UNAVAILABLE',
    );
    expect(vipSummaryRequestedValue(draft), '0');
    expect(vipSummaryRequestedValue(submitted), '100');
    expect(vipSummaryIntentionsValue(submitted), '4');
    expect(vipSummaryRecordedSendsValue(submitted), '2');
    expect(vipSummaryVisitedValue(submitted), '1');
    expect(vipSummaryIntentionsValue(unavailable), '—');
    expect(vipSummaryVisitedValue(unavailable), '—');
    expect(vipSummaryRecordedSendsValue(unavailable), '0');
  });

  testWidgets('after submit the new request is first, once, above older history', (
    tester,
  ) async {
    final draft = _request(
      id: southeast.id,
      status: 'AWAITING_SAMPLE_WORK',
      listName: southeast.listName,
      requestedCount: 100,
      createdAt: southeast.createdAt,
      sampleWorks: const [
        VipSampleWork(
          id: 'sw1',
          position: 1,
          contentType: 'image/jpeg',
          byteSize: 12,
        ),
      ],
      progress: const VipRequestProgress(
        headline: 'در انتظار ارسال نمونه‌کارهای شما',
        explanation: 'سالن باید نمونه کار را بارگذاری کند.',
        nextActor: 'SALON',
        nextActorLabel: 'اقدام بعدی با سالن است',
        reservationStillValid: true,
      ),
    );
    final repo = _Repo(
      capabilities: [
        VipCapability(
          entitled: true,
          remainingQuota: 328,
          usedQuota: 172,
          activeDraft: draft,
          currentRequest: draft,
        ),
        VipCapability(
          entitled: true,
          remainingQuota: 228,
          usedQuota: 272,
          inProgressRequests: [southeast, older72, older100],
        ),
      ],
      historyItems: [_item(older72), _item(older100), _item(draft)],
      submitResult: southeast,
    );
    await _pumpSalon(tester, repo);
    expect(find.text(AppStrings.vipAddSample), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('VIP-12-01')).dy <
          tester.getTopLeft(find.text('VIP-05-02')).dy,
      isTrue,
    );
    await tester.tap(find.text(AppStrings.vipSubmit));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vip-summary-vip-12-01')), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRequested}: 72'), findsOneWidget);
    expect(find.text(AppStrings.vipStartNewRequest), findsOneWidget);
    expect(find.text(AppStrings.recordVisitIntention), findsWidgets);
    expect(
      tester.getTopLeft(find.byKey(const Key('vip-summary-vip-12-01'))).dy <
          tester.getTopLeft(find.byKey(const Key('vip-summary-vip-05-02'))).dy,
      isTrue,
    );
    expect(
      tester.getTopLeft(find.byKey(const Key('vip-summary-vip-05-02'))).dy <
          tester.getTopLeft(find.byKey(const Key('vip-summary-vip-06-01'))).dy,
      isTrue,
    );
  });

  testWidgets('stale history cannot put older cards above the new confirmation', (
    tester,
  ) async {
    final draft = _request(
      id: southeast.id,
      status: 'AWAITING_SAMPLE_WORK',
      listName: southeast.listName,
      requestedCount: 100,
      createdAt: southeast.createdAt,
      sampleWorks: const [
        VipSampleWork(
          id: 'sw1',
          position: 1,
          contentType: 'image/jpeg',
          byteSize: 12,
        ),
      ],
      progress: const VipRequestProgress(
        headline: 'در انتظار ارسال نمونه‌کارهای شما',
        explanation: 'سالن باید نمونه کار را بارگذاری کند.',
        nextActor: 'SALON',
        nextActorLabel: 'اقدام بعدی با سالن است',
        reservationStillValid: true,
      ),
    );
    final repo = _Repo(
      capabilities: [
        VipCapability(
          entitled: true,
          remainingQuota: 328,
          usedQuota: 172,
          activeDraft: draft,
          currentRequest: draft,
        ),
        const VipCapability(
          entitled: true,
          remainingQuota: 228,
          usedQuota: 272,
        ),
      ],
      historyItems: [_item(older72), _item(older100)],
      submitResult: southeast,
      updateHistoryOnSubmit: false,
    );
    await _pumpSalon(tester, repo);
    await tester.tap(find.text(AppStrings.vipSubmit));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vip-summary-vip-12-01')), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(const Key('vip-summary-vip-12-01'))).dy <
          tester.getTopLeft(find.byKey(const Key('vip-summary-vip-05-02'))).dy,
      isTrue,
    );
  });

  testWidgets('choosing a package group does not reload VIP history', (tester) async {
    final repo = _Repo(
      capabilities: [
        VipCapability(
          entitled: true,
          remainingQuota: 400,
          usedQuota: 100,
          inProgressRequests: [older72],
        ),
      ],
      historyItems: [_item(older72)],
    );
    await _pumpSalon(tester, repo);
    expect(repo.requestHistoryCalls, 1);
    await tester.tap(find.byKey(const Key('vip-request-size-100')));
    await tester.pump();
    expect(repo.requestHistoryCalls, 1);
    expect(find.text('VIP-05-02'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text(AppStrings.vipDesiredRegion)).dy <
          tester.getTopLeft(find.text('VIP-05-02')).dy,
      isTrue,
    );
  });

  testWidgets('send and opportunities screens show the same four metrics', (
    tester,
  ) async {
    final item = _item(
      southeast,
      reportedIntentionCount: 3,
      manualRecordedSendCount: 2,
      visitedRecipientCount: 1,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              VipRequestSummaryCard(item: item),
              VipRequestSummaryCard(item: item),
            ],
          ),
        ),
      ),
    );
    expect(find.text('${AppStrings.vipHistoryRequested}: 100'), findsNWidgets(2));
    expect(find.text('${AppStrings.vipHistoryIntentions}: 3'), findsNWidgets(2));
    expect(find.text('${AppStrings.vipHistoryRecordedSends}: 2'), findsNWidgets(2));
    expect(find.text('${AppStrings.vipHistoryVisited}: 1'), findsNWidgets(2));
  });

  testWidgets('visit-intention remains reachable from the compact summary', (
    tester,
  ) async {
    final repo = _Repo(
      capabilities: [
        VipCapability(
          entitled: true,
          remainingQuota: 228,
          usedQuota: 272,
        ),
      ],
      historyItems: [_item(southeast)],
    );
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (_, __) => const Scaffold(body: SalonVipSection()),
        ),
        GoRoute(
          path: '/vip/requests/:id/visit-intention',
          builder: (_, state) => Scaffold(
            body: Text('intention-route:${state.pathParameters['id']}'),
          ),
        ),
      ],
    );
    tester.view.physicalSize = const Size(800, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.recordVisitIntention));
    await tester.pumpAndSettle();
    expect(find.text('intention-route:vip-12-01'), findsOneWidget);
  });
}
