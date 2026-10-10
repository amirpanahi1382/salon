import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/widgets/app_widgets.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/vip/salon_vip_section.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

class _FakeVipRepository extends VipRepository {
  _FakeVipRepository({
    this.entitled = true,
    required this.regionItems,
    this.listsByCode = const {},
    this.listsError,
    this.createError,
    this.capabilityValue,
    this.capabilityImpl,
  }) : super(_client());

  final bool entitled;
  final List<VipRegion> regionItems;
  final Map<String, List<VipTargetList>> listsByCode;
  final Object? listsError;
  final Object? createError;
  final VipCapability? capabilityValue;
  final Future<VipCapability> Function()? capabilityImpl;
  final List<String> listRequests = [];

  @override
  Future<VipCapability> capability() {
    if (capabilityImpl != null) {
      return capabilityImpl!();
    }
    return Future.value(
      capabilityValue ??
          VipCapability(
            entitled: entitled,
            remainingQuota: 100,
            usedQuota: 0,
          ),
    );
  }

  @override
  Future<List<VipRegion>> regions() async => regionItems;

  @override
  Future<List<VipTargetList>> listsByRegion(String regionCode) async {
    listRequests.add(regionCode);
    if (listsError != null) {
      throw listsError!;
    }
    return listsByCode[regionCode] ?? const [];
  }

  @override
  Future<VipRequest> createRequest({
    required String listId,
    required int requestedCount,
    required String geographicRange,
    required String idempotencyKey,
  }) async {
    if (createError != null) {
      throw createError!;
    }
    return VipRequest(
      id: 'req-1',
      salonId: 's1',
      salonName: 'Salon',
      listId: listId,
      listName: 'VIP-01-08',
      requestedCount: requestedCount,
      geographicRange: geographicRange,
      status: 'AWAITING_SAMPLE_WORK',
    );
  }
}

const _catalog = <String, String>{
  '01': 'مرکز؛ حسن‌آباد، بازار و انقلاب',
  '02': 'شمال؛ ونک، تجریش و پاسداران',
  '03': 'شمال‌غرب؛ سعادت‌آباد، پونک و جنت‌آباد',
  '04': 'غرب؛ صادقیه، آزادی و چیتگر',
  '05': 'جنوب‌غرب؛ شادآباد، یافت‌آباد و نواب',
  '06': 'جنوب؛ نازی‌آباد، شهرری و کهریزک',
  '07': 'شرق؛ نارمک، تهرانپارس و شمیران‌نو',
  '08': 'جنوب‌شرق؛ پیروزی، افسریه و خاوران',
  '09': 'حومه غرب؛ شهریار، قدس و کرج',
  '10': 'حومه جنوب‌غرب؛ اسلامشهر، رباط‌کریم و پرند',
  '11': 'حومه جنوب؛ حسن‌آباد فشافویه و شمس‌آباد',
  '12': 'حومه جنوب‌شرق؛ پاکدشت، قرچک و ورامین',
  '13': 'حومه شمال‌شرق؛ جاجرود، پردیس و دماوند',
  '14': 'حومه شمال؛ لواسان، فشم و میگون',
};

List<VipRegion> _regions() {
  return [
    for (final entry in _catalog.entries)
      VipRegion(
        regionCode: entry.key,
        regionName: entry.value,
        availableListCount: entry.key == '11' || entry.key == '14' ? 0 : 1,
        availableContactCount: entry.key == '11' || entry.key == '14' ? 0 : 100,
      ),
  ];
}

VipTargetList _list({
  required String id,
  required String name,
  required String regionCode,
  required int contactCount,
}) {
  return VipTargetList(
    id: id,
    name: name,
    status: 'ACTIVE',
    contactCount: contactCount,
    regionCode: regionCode,
    regionName: _catalog[regionCode],
  );
}

Future<void> _pump(
  WidgetTester tester,
  _FakeVipRepository repo,
) async {
  tester.view.physicalSize = const Size(800, 1400);
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
  testWidgets('non-VIP salon cannot enter region inventory', (tester) async {
    await _pump(tester, _FakeVipRepository(entitled: false, regionItems: _regions()));
    expect(find.text(AppStrings.vipNeedEntitlement), findsWidgets);
    expect(find.text(AppStrings.vipDesiredRegion), findsNothing);
  });

  testWidgets('entitled salon selects one of 14 regions from the server catalog', (
    tester,
  ) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      listsByCode: {
        '01': [
          _list(id: 'a', name: 'VIP-01-01', regionCode: '01', contactCount: 100),
          _list(id: 'b', name: 'VIP-01-08', regionCode: '01', contactCount: 65),
        ],
        '02': [
          _list(id: 'c', name: 'VIP-02-01', regionCode: '02', contactCount: 74),
          _list(id: 'd', name: 'VIP-02-02', regionCode: '02', contactCount: 30),
        ],
      },
    );
    await _pump(tester, repo);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
    await tester.tap(find.text(AppStrings.vipSelectRegion));
    await tester.pumpAndSettle();
    expect(find.textContaining('01 — ', skipOffstage: false), findsOneWidget);
    expect(find.textContaining('14 — ', skipOffstage: false), findsOneWidget);
    expect(find.textContaining(' — ', skipOffstage: false), findsNWidgets(14));

    await tester.tap(find.textContaining('01 — '));
    await tester.pumpAndSettle();
    expect(repo.listRequests, ['01']);
    expect(find.text('VIP-01-01'), findsOneWidget);
    expect(find.text('VIP-01-08'), findsOneWidget);
    expect(find.text('مرکز؛ حسن‌آباد، بازار و انقلاب'), findsWidgets);
    expect(find.text('VIP-02-01'), findsNothing);
    expect(find.textContaining('0912'), findsNothing);

    await tester.tap(find.textContaining('01 — '));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('02 — '));
    await tester.pumpAndSettle();
    expect(repo.listRequests, ['01', '02']);
    expect(find.text('VIP-02-01'), findsOneWidget);
    expect(find.text('VIP-02-02'), findsOneWidget);
    expect(find.text('VIP-01-08'), findsNothing);
  });

  testWidgets('regions 11 and 14 show a truthful empty state', (tester) async {
    final repo = _FakeVipRepository(regionItems: _regions());
    await _pump(tester, repo);
    await tester.tap(find.text(AppStrings.vipSelectRegion));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.textContaining('11 — ', skipOffstage: false));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('11 — '));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipNoActiveListsInRegion), findsWidgets);
    expect(find.text('VIP-11-01'), findsNothing);

    await tester.tap(find.textContaining('11 — '));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.textContaining('14 — ', skipOffstage: false));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('14 — '));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipNoActiveListsInRegion), findsWidgets);
  });

  testWidgets('a 65-contact list does not allow requesting 100', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      listsByCode: {
        '01': [
          _list(id: 'b', name: 'VIP-01-08', regionCode: '01', contactCount: 65),
        ],
      },
    );
    await _pump(tester, repo);
    await tester.tap(find.text(AppStrings.vipSelectRegion));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('01 — '));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, '30'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VIP-01-08'));
    await tester.pumpAndSettle();
    final hundred = tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '100'));
    expect(hundred.onSelected, isNull);
  });

  testWidgets('list load error is not treated as an empty region', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      listsError: const ApiException(
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
      ),
    );
    await _pump(tester, repo);
    await tester.tap(find.text(AppStrings.vipSelectRegion));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('01 — '));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipNoActiveListsInRegion), findsNothing);
    expect(find.text(AppStrings.genericError), findsOneWidget);
  });

  testWidgets('stale list confirmation refreshes the current region', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      listsByCode: {
        '01': [
          _list(id: 'gone', name: 'VIP-01-01', regionCode: '01', contactCount: 100),
        ],
      },
      createError: const ApiException(
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This VIP list is not available',
      ),
    );
    await _pump(tester, repo);
    await tester.tap(find.text(AppStrings.vipSelectRegion));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('01 — '));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, '30'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VIP-01-01'));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.sendMessageAction));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipListUnavailable), findsOneWidget);
    expect(repo.listRequests, ['01', '01']);
  });

  testWidgets('submitted history stays visible beside the region form', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: VipCapability(
        entitled: true,
        remainingQuota: 400,
        usedQuota: 100,
        quotaMax: 500,
        quotaWindowDays: 7,
        inProgressRequests: [
          _request(status: 'SUBMITTED', listName: 'VIP-03-01', requestedCount: 100),
        ],
      ),
    );
    await _pump(tester, repo);
    expect(find.text(AppStrings.vipInProgressRequests), findsOneWidget);
    expect(find.text('VIP-03-01'), findsOneWidget);
    expect(find.text('${AppStrings.vipNeedsReview} · 100'), findsOneWidget);
    expect(find.textContaining('SUBMITTED'), findsNothing);
    expect(find.text(AppStrings.vipRemainingQuota(400)), findsOneWidget);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
    expect(find.text(AppStrings.vipAddSample), findsNothing);
  });

  testWidgets('an active draft shows the sample workflow', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: VipCapability(
        entitled: true,
        remainingQuota: 400,
        usedQuota: 100,
        activeDraft: _request(
          status: 'AWAITING_SAMPLE_WORK',
          listName: 'VIP-04-01',
          requestedCount: 50,
        ),
      ),
    );
    await _pump(tester, repo);
    expect(find.text(AppStrings.vipAddSample), findsOneWidget);
    expect(find.text(AppStrings.vipSubmit), findsOneWidget);
    expect(find.text(AppStrings.vipDesiredRegion), findsNothing);
    expect(find.text('${AppStrings.vipPending} · 50'), findsOneWidget);
    expect(find.textContaining('AWAITING_SAMPLE_WORK'), findsNothing);
  });

  testWidgets('sizes above remaining quota are disabled', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: const VipCapability(
        entitled: true,
        remainingQuota: 40,
        usedQuota: 460,
        allowedRequestCounts: [30, 50, 100],
      ),
    );
    await _pump(tester, repo);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '30')).onSelected, isNotNull);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '50')).onSelected, isNull);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '100')).onSelected, isNull);
  });

  testWidgets('an older capability response cannot replace a newer one', (tester) async {
    final first = Completer<VipCapability>();
    final second = Completer<VipCapability>();
    var calls = 0;
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityImpl: () {
        calls += 1;
        return calls == 1 ? first.future : second.future;
      },
    );
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: Scaffold(body: SalonVipSection())),
      ),
    );
    await tester.pump();
    expect(find.byType(LoadingSkeleton), findsOneWidget);
    await tester.fling(find.byType(ListView), const Offset(0, 400), 1200);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    second.complete(
      VipCapability(
        entitled: true,
        remainingQuota: 400,
        usedQuota: 100,
        inProgressRequests: [
          _request(status: 'SUBMITTED', listName: 'VIP-03-01', requestedCount: 100),
        ],
      ),
    );
    await tester.pump();
    first.complete(
      VipCapability(
        entitled: true,
        remainingQuota: 450,
        usedQuota: 50,
        activeDraft: _request(
          status: 'AWAITING_SAMPLE_WORK',
          listName: 'VIP-04-01',
          requestedCount: 50,
        ),
      ),
    );
    await tester.pump();
    expect(calls, 2);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
    expect(find.text('VIP-03-01'), findsOneWidget);
    expect(find.text(AppStrings.vipAddSample), findsNothing);
  });

  testWidgets('remaining quota below the minimum request size is explained', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: const VipCapability(
        entitled: true,
        remainingQuota: 20,
        usedQuota: 480,
        allowedRequestCounts: [30, 50, 100],
        inProgressRequests: [],
      ),
    );
    await _pump(tester, repo);
    expect(find.text(AppStrings.vipQuotaBelowMinimum(20)), findsWidgets);
    expect(find.text(AppStrings.vipQuotaExhausted), findsNothing);
    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text(AppStrings.sendMessageAction), findsNothing);
  });

  testWidgets('history statuses use Persian labels', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: VipCapability(
        entitled: true,
        remainingQuota: 400,
        usedQuota: 100,
        inProgressRequests: [
          _request(status: 'SUBMITTED', listName: 'VIP-03-01', requestedCount: 100),
          _request(status: 'MANUAL_QUEUED', listName: 'VIP-04-01', requestedCount: 50),
          _request(status: 'BALE_NOT_IMPLEMENTED', listName: 'VIP-05-01', requestedCount: 30),
        ],
      ),
    );
    await _pump(tester, repo);
    expect(find.text('${AppStrings.vipNeedsReview} · 100'), findsOneWidget);
    expect(find.text('${AppStrings.outreachStatusQueued} · 50'), findsOneWidget);
    expect(find.text('${AppStrings.vipBaleNotImplemented} · 30'), findsOneWidget);
    expect(find.textContaining('MANUAL_QUEUED'), findsNothing);
    expect(find.textContaining('BALE_NOT_IMPLEMENTED'), findsNothing);
  });

  testWidgets('a refreshed capability disables a stale oversized selection', (tester) async {
    final responses = <VipCapability>[
      const VipCapability(
        entitled: true,
        remainingQuota: 400,
        usedQuota: 100,
        allowedRequestCounts: [30, 50, 100],
      ),
      const VipCapability(
        entitled: true,
        remainingQuota: 40,
        usedQuota: 460,
        allowedRequestCounts: [30, 50, 100],
      ),
    ];
    var calls = 0;
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      listsByCode: {
        '01': [_list(id: 'list-01', name: 'VIP-01-01', regionCode: '01', contactCount: 100)],
      },
      capabilityImpl: () async => responses[calls++],
    );
    await _pump(tester, repo);
    await tester.tap(find.text(AppStrings.vipSelectRegion));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('01 — '));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, '100'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VIP-01-01'));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, AppStrings.sendMessageAction)).onPressed, isNotNull);
    await tester.fling(find.byType(ListView).first, const Offset(0, 400), 1200);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '100')).onSelected, isNull);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '30')).onSelected, isNotNull);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, AppStrings.sendMessageAction)).onPressed, isNull);
    expect(calls, 2);
  });

  testWidgets('more than ten in-progress requests explains the truncated summary', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: VipCapability(
        entitled: true,
        remainingQuota: 170,
        usedQuota: 330,
        inProgressRequestsHasMore: true,
        inProgressRequests: [
          _request(status: 'SUBMITTED', listName: 'VIP-03-01', requestedCount: 30),
        ],
      ),
    );
    await _pump(tester, repo);
    expect(find.text(AppStrings.vipInProgressRequestsTruncated), findsOneWidget);
    expect(find.text('VIP-03-01'), findsOneWidget);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
  });

  testWidgets('a complete in-progress summary does not show the truncation notice', (tester) async {
    final repo = _FakeVipRepository(
      regionItems: _regions(),
      capabilityValue: VipCapability(
        entitled: true,
        remainingQuota: 400,
        usedQuota: 100,
        inProgressRequestsHasMore: false,
        inProgressRequests: [
          _request(status: 'SUBMITTED', listName: 'VIP-03-01', requestedCount: 100),
        ],
      ),
    );
    await _pump(tester, repo);
    expect(find.text(AppStrings.vipInProgressRequests), findsOneWidget);
    expect(find.text('VIP-03-01'), findsOneWidget);
    expect(find.text(AppStrings.vipInProgressRequestsTruncated), findsNothing);
  });
}

VipRequest _request({
  required String status,
  required String listName,
  required int requestedCount,
}) {
  return VipRequest(
    id: 'request-$listName',
    salonId: 'salon',
    salonName: 'Salon',
    listId: 'list',
    listName: listName,
    status: status,
    geographicRange: 'شمال‌غرب؛ سعادت‌آباد، پونک و جنت‌آباد',
    requestedCount: requestedCount,
  );
}
