import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/vip/salon_vip_section.dart';
import 'package:salon_mobile/features/vip/vip_progress_card.dart';
import 'package:salon_mobile/features/vip/vip_progress_copy.dart';
import 'package:salon_mobile/features/vip/vip_request_summary.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

VipRequestProgress _progress({
  required String headline,
  required String explanation,
  required String nextActor,
  required String nextActorLabel,
  bool reservationStillValid = false,
  String? latestActionLabel,
  DateTime? latestActionAt,
  List<VipProgressCountLine> countLines = const [],
  String? countsOmittedReason,
  String? activeStopNote,
  String? listReservationNote,
}) {
  return VipRequestProgress(
    headline: headline,
    explanation: explanation,
    nextActor: nextActor,
    nextActorLabel: nextActorLabel,
    reservationStillValid: reservationStillValid,
    latestActionLabel: latestActionLabel,
    latestActionAt: latestActionAt,
    countLines: countLines,
    countsOmittedReason: countsOmittedReason,
    activeStopNote: activeStopNote,
    listReservationNote: listReservationNote,
  );
}

VipRequest _request({
  required String id,
  required String status,
  VipRequestProgress? progress,
  String listName = 'VIP-01-01',
  int requestedCount = 30,
  List<VipSampleWork> sampleWorks = const [],
  DateTime? createdAt,
  DateTime? submittedAt,
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

VipRequestHistoryItem _historyItem(
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

class _ScriptedVipRepository extends VipRepository {
  _ScriptedVipRepository(
    this.capabilities, {
    this.submitResult,
    this.submitError,
    this.historyItems = const [],
    this.updateHistoryOnSubmit = true,
  }) : super(_client());

  final List<Future<VipCapability>> capabilities;
  final VipRequest? submitResult;
  final Object? submitError;
  List<VipRequestHistoryItem> historyItems;
  final bool updateHistoryOnSubmit;
  int index = 0;
  int submitCalls = 0;
  int requestHistoryCalls = 0;

  @override
  Future<VipCapability> capability() {
    return capabilities[index++];
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
    if (submitError != null) {
      throw submitError!;
    }
    final submitted = submitResult!;
    if (updateHistoryOnSubmit) {
      historyItems = [
        _historyItem(submitted),
        for (final item in historyItems)
          if (item.request.id != submitted.id) item,
      ];
    }
    return submitted;
  }
}

Future<void> _pumpCard(WidgetTester tester, VipRequestProgress progress) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: VipProgressCard(progress: progress)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpSalon(WidgetTester tester, _ScriptedVipRepository repo) async {
  tester.view.physicalSize = const Size(800, 1600);
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
  testWidgets('shows every VIP branch from server copy, in RTL', (tester) async {
    final branches = <VipRequestProgress>[
      _progress(
        headline: 'در انتظار ارسال نمونه‌کارهای شما',
        explanation: 'تا پایان مهلت ۳۰ دقیقه‌ای رزرو، نمونه‌کار را بارگذاری کنید و درخواست را ثبت کنید. هنوز پیامی ساخته نشده است.',
        nextActor: 'SALON',
        nextActorLabel: 'اقدام بعدی با سالن است',
        reservationStillValid: true,
        listReservationNote: 'رزرو فهرست یعنی این فهرست برای تکمیل همین پیش‌نویس نگه داشته شده است، نه اینکه پیامی در حال ارسال باشد.',
      ),
      _progress(
        headline: 'دوباره تلاش کنید',
        explanation: 'مهلت ۳۰ دقیقه‌ای تکمیل این پیش‌نویس تمام شده است. از این پیش‌نویس پیامی ارسال نشده است. اگر هنوز مجاز باشید، یک درخواست جدید شروع کنید.',
        nextActor: 'NONE',
        nextActorLabel: 'برای این پیش‌نویس کار دیگری نمانده است',
      ),
      _progress(
        headline: 'درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود',
        explanation: 'این عنوان فقط ثبت درخواست است و به معنای ارسال یا تحویل پیام نیست.',
        nextActor: 'PLATFORM_ADMIN',
        nextActorLabel: 'ادامهٔ کار با تأیید ادمین است',
        countLines: const [
          VipProgressCountLine(key: 'notYetQueued', label: 'هنوز به صف پیام نرسیده', count: 30),
        ],
      ),
      _progress(
        headline: 'درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید',
        explanation: 'علامت ارسال دستی تحویل قطعی پیام نیست',
        nextActor: 'PLATFORM_ADMIN',
        nextActorLabel: 'ادامهٔ کار با تأیید ادمین است',
        countLines: const [
          VipProgressCountLine(key: 'inHandling', label: 'در حال رسیدگی', count: 1),
          VipProgressCountLine(key: 'manuallyMarkedSent', label: 'علامت‌خورده به‌عنوان ارسال دستی', count: 1),
          VipProgressCountLine(key: 'failed', label: 'ارسال ناموفق', count: 1),
          VipProgressCountLine(key: 'cancelledMessage', label: 'از صف پیام خارج شده', count: 1),
          VipProgressCountLine(key: 'durablySkipped', label: 'برای این درخواست دیگر پیام نمی‌گیرد', count: 1),
        ],
        activeStopNote: 'این تعداد جدا از شمارش گیرنده‌هاست',
        latestActionLabel: 'آخرین علامت ارسال دستی',
        latestActionAt: DateTime.utc(2026, 10, 14, 8),
      ),
      _progress(
        headline: 'رسیدگی پایان یافت؛ ارسالی برای این درخواست ثبت نشد',
        explanation: 'این عنوان فقط ثبت درخواست است و به معنای ارسال یا تحویل پیام نیست.',
        nextActor: 'NONE',
        nextActorLabel: 'نتیجهٔ هر گیرنده در شمارش پایین است',
        countLines: const [
          VipProgressCountLine(key: 'failed', label: 'ارسال ناموفق', count: 1),
          VipProgressCountLine(key: 'cancelledMessage', label: 'از صف پیام خارج شده', count: 1),
          VipProgressCountLine(key: 'durablySkipped', label: 'برای این درخواست دیگر پیام نمی‌گیرد', count: 1),
        ],
      ),
      _progress(
        headline: 'رسیدگی به این درخواست پایان یافت؛ نتیجهٔ هر گیرنده را پایین ببینید',
        explanation: 'علامت ارسال دستی تحویل قطعی پیام نیست.',
        nextActor: 'NONE',
        nextActorLabel: 'نتیجهٔ هر گیرنده در شمارش پایین است',
        countLines: const [
          VipProgressCountLine(key: 'manuallyMarkedSent', label: 'علامت‌خورده به‌عنوان ارسال دستی', count: 1),
          VipProgressCountLine(key: 'failed', label: 'ارسال ناموفق', count: 1),
        ],
      ),
      _progress(
        headline: 'اتمام مهلت ارسال درخواست',
        explanation: 'این پایان مهلت پیش‌نویس است، نه ناموفق بودن یک ارسال.',
        nextActor: 'NONE',
        nextActorLabel: 'برای این پیش‌نویس کار دیگری نمانده است',
        latestActionLabel: 'بستن پیش‌نویس',
        latestActionAt: DateTime.utc(2026, 10, 13, 8),
      ),
      _progress(
        headline: 'درخواست لغو شده است',
        explanation: 'این مورد را پایان مهلت پیش‌نویس یا ناموفق بودن ارسال حساب نمی‌کنیم.',
        nextActor: 'NONE',
        nextActorLabel: 'برای این پیش‌نویس کار دیگری نمانده است',
        countsOmittedReason: 'شمارش گیرنده‌ها با ردیف‌های شناخته‌شده یکی نیست و نشان داده نمی‌شود.',
      ),
    ];

    for (final progress in branches) {
      await _pumpCard(tester, progress);
      expect(find.text(progress.headline), findsOneWidget);
      expect(find.text(progress.nextActorLabel), findsOneWidget);
      if (shouldDisplayVipProgressExplanation(progress.explanation)) {
        expect(find.text(progress.explanation), findsOneWidget);
      } else {
        expect(find.text(progress.explanation), findsNothing);
        expect(
          find.textContaining('به معنای ارسال یا تحویل پیام نیست'),
          findsNothing,
        );
      }
      expect(
        tester.widget<Directionality>(find.descendant(
          of: find.byType(VipProgressCard),
          matching: find.byType(Directionality),
        )).textDirection,
        TextDirection.rtl,
      );
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              (widget.properties.label ?? '').contains(progress.headline),
        ),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.storefront_outlined), progress.nextActor == 'SALON' ? findsOneWidget : findsNothing);
      expect(find.byIcon(Icons.support_agent_outlined), progress.nextActor == 'PLATFORM_ADMIN' ? findsOneWidget : findsNothing);
      expect(find.byIcon(Icons.flag_outlined), progress.nextActor == 'NONE' ? findsOneWidget : findsNothing);
    }
  });

  testWidgets('manual counts, durable skip, and active stop stay separate', (tester) async {
    await _pumpCard(
      tester,
      _progress(
        headline: 'درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید',
        explanation: 'این گیرنده‌ها برای همین درخواست پیام نمی‌گیرند، حتی اگر توقف کلی برداشته شود.',
        nextActor: 'PLATFORM_ADMIN',
        nextActorLabel: 'ادامهٔ کار با تأیید ادمین است',
        countLines: const [
          VipProgressCountLine(key: 'durablySkipped', label: 'برای این درخواست دیگر پیام نمی‌گیرد', count: 1),
          VipProgressCountLine(key: 'notYetQueued', label: 'هنوز به صف پیام نرسیده', count: 1),
        ],
        activeStopNote: 'برای ۱ گیرنده توقف سراسری الان فعال است.',
      ),
    );
    expect(find.text('برای این درخواست دیگر پیام نمی‌گیرد: ۱'), findsOneWidget);
    expect(find.text('هنوز به صف پیام نرسیده: ۱'), findsOneWidget);
    expect(find.textContaining('توقف سراسری الان فعال است'), findsOneWidget);
    expect(find.textContaining('0912'), findsNothing);
  });

  testWidgets('a valid draft keeps sample actions beside the salon explanation', (tester) async {
    final draft = _request(
      id: 'draft',
      status: 'AWAITING_SAMPLE_WORK',
      progress: _progress(
        headline: 'در انتظار ارسال نمونه‌کارهای شما',
        explanation: 'سالن باید نمونه کار را بارگذاری کند.',
        nextActor: 'SALON',
        nextActorLabel: 'اقدام بعدی با سالن است',
        reservationStillValid: true,
        listReservationNote: 'رزرو فهرست یعنی این فهرست برای تکمیل همین پیش‌نویس نگه داشته شده است، نه اینکه پیامی در حال ارسال باشد.',
      ),
    );
    await _pumpSalon(
      tester,
      _ScriptedVipRepository([
        Future.value(VipCapability(
          entitled: true,
          remainingQuota: 500,
          usedQuota: 0,
          activeDraft: draft,
          currentRequest: draft,
        )),
      ]),
    );
    expect(find.text('در انتظار ارسال نمونه‌کارهای شما'), findsOneWidget);
    expect(find.text(draft.listName), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRequested}: 0'), findsOneWidget);
    expect(find.text(AppStrings.vipRequestedRecipientCount(draft.requestedCount)), findsOneWidget);
    expect(find.text(AppStrings.vipSampleProgress(0)), findsOneWidget);
    expect(find.textContaining('نه اینکه پیامی در حال ارسال باشد'), findsNothing);
    expect(find.text(AppStrings.vipAddSample), findsOneWidget);
    expect(find.text(AppStrings.vipSubmit), findsOneWidget);
  });

  testWidgets('submitted, skipped, and expired draft stay distinct on the salon view', (
    tester,
  ) async {
    final submitted = _request(
      id: 'submitted',
      status: 'SUBMITTED',
      listName: 'فهرست ثبت',
      requestedCount: 30,
      createdAt: DateTime.utc(2026, 11, 21, 12),
      submittedAt: DateTime.utc(2026, 11, 21, 12, 1),
    );
    final manual = _request(
      id: 'manual',
      status: 'MANUAL_QUEUED',
      listName: 'فهرست دستی',
      requestedCount: 30,
      createdAt: DateTime.utc(2026, 11, 20, 12),
      submittedAt: DateTime.utc(2026, 11, 20, 12, 1),
    );
    final cancelled = _request(
      id: 'cancelled',
      status: 'CANCELLED',
      listName: 'فهرست لغوشده',
      createdAt: DateTime.utc(2026, 11, 19, 12),
    );
    await _pumpSalon(
      tester,
      _ScriptedVipRepository(
        [
          Future.value(VipCapability(
            entitled: true,
            remainingQuota: 400,
            usedQuota: 100,
            inProgressRequests: [submitted, manual],
            latestCancelledRequest: cancelled,
          )),
        ],
        historyItems: [
          _historyItem(submitted, reportedIntentionCount: 1, visitedRecipientCount: 0),
          _historyItem(manual, manualRecordedSendCount: 2),
          _historyItem(
            cancelled,
            reportedIntentionCount: null,
            visitedRecipientCount: null,
            metricsAvailability: 'UNAVAILABLE',
          ),
        ],
      ),
    );
    expect(find.text('فهرست ثبت'), findsOneWidget);
    expect(find.text('فهرست دستی'), findsOneWidget);
    expect(find.text('فهرست لغوشده'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRequested}: 30'), findsNWidgets(2));
    expect(find.text('${AppStrings.vipHistoryRequested}: 0'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryIntentions}: 1'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRecordedSends}: 2'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryIntentions}: —'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryVisited}: —'), findsOneWidget);
    expect(find.text('درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود'), findsNothing);
    expect(find.text('هنوز به صف پیام نرسیده: ۳۰'), findsNothing);
    expect(find.textContaining('توقف فعال جدا'), findsNothing);
    expect(find.text('اتمام مهلت ارسال درخواست'), findsNothing);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
    expect(find.text(AppStrings.vipAddSample), findsNothing);
    expect(find.textContaining('09120000000'), findsNothing);
    expect(find.textContaining('متن محرمانه'), findsNothing);
    expect(
      tester.getTopLeft(find.text('فهرست ثبت')).dy <
          tester.getTopLeft(find.text('فهرست دستی')).dy,
      isTrue,
    );
    expect(
      tester.getTopLeft(find.text('فهرست دستی')).dy <
          tester.getTopLeft(find.text('فهرست لغوشده')).dy,
      isTrue,
    );
    expect(
      tester.getTopLeft(find.text(AppStrings.vipDesiredRegion)).dy <
          tester.getTopLeft(find.text('فهرست ثبت')).dy,
      isTrue,
    );
  });

  testWidgets('a stale salon capability cannot replace the newer progress', (tester) async {
    final older = Completer<VipCapability>();
    final newer = Completer<VipCapability>();
    final repo = _ScriptedVipRepository([older.future, newer.future]);
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: Scaffold(body: SalonVipSection())),
      ),
    );
    await tester.pump();
    final indicator = tester.widget<RefreshIndicator>(find.byType(RefreshIndicator));
    final newerLoad = indicator.onRefresh();
    newer.complete(const VipCapability(
      entitled: true,
      remainingQuota: 370,
      usedQuota: 130,
    ));
    await newerLoad;
    await tester.pumpAndSettle();
    older.complete(const VipCapability(
      entitled: true,
      remainingQuota: 500,
      usedQuota: 0,
    ));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipRemainingQuota(370)), findsOneWidget);
    expect(find.text(AppStrings.vipRemainingQuota(500)), findsNothing);
  });

  testWidgets('a cancelled-only history still shows the expiry card with its list', (tester) async {
    final cancelled = _request(
      id: 'cancelled-only',
      status: 'CANCELLED',
      listName: 'فهرست منقضی',
      progress: _progress(
        headline: 'اتمام مهلت ارسال درخواست',
        explanation: 'از این پیش‌نویس پیامی ارسال نشده است.',
        nextActor: 'NONE',
        nextActorLabel: 'برای این پیش‌نویس کار دیگری نمانده است',
      ),
    );
    await _pumpSalon(
      tester,
      _ScriptedVipRepository(
        [
          Future.value(const VipCapability(
            entitled: true,
            remainingQuota: 500,
            usedQuota: 0,
            inProgressRequests: [],
          )),
        ],
        historyItems: [
          _historyItem(
            cancelled,
            reportedIntentionCount: null,
            visitedRecipientCount: null,
            metricsAvailability: 'UNAVAILABLE',
          ),
        ],
      ),
    );
    expect(find.text(AppStrings.vipInProgressRequests), findsNothing);
    expect(find.text('فهرست منقضی'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRequested}: 0'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryIntentions}: —'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryVisited}: —'), findsOneWidget);
    expect(find.text('اتمام مهلت ارسال درخواست'), findsNothing);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
    expect(
      tester.getTopLeft(find.text(AppStrings.vipDesiredRegion)).dy <
          tester.getTopLeft(find.text('فهرست منقضی')).dy,
      isTrue,
    );
  });

  testWidgets('successful submit shows progress without the creation form', (
    tester,
  ) async {
    const explanation =
        'این عنوان فقط ثبت درخواست است و به معنای ارسال یا تحویل پیام نیست. علامت ارسال دستی تحویل قطعی پیام نیست و نتیجهٔ ناموفق، لغو یا ارسال‌نشدن پنهان نمی‌شود.';
    final draft = _request(
      id: 'draft',
      status: 'AWAITING_SAMPLE_WORK',
      sampleWorks: const [
        VipSampleWork(
          id: 'sw1',
          position: 1,
          contentType: 'image/jpeg',
          byteSize: 12,
        ),
      ],
      progress: _progress(
        headline: 'در انتظار ارسال نمونه‌کارهای شما',
        explanation: 'سالن باید نمونه کار را بارگذاری کند.',
        nextActor: 'SALON',
        nextActorLabel: 'اقدام بعدی با سالن است',
        reservationStillValid: true,
      ),
    );
    final submitted = _request(
      id: 'draft',
      status: 'SUBMITTED',
      requestedCount: 100,
      createdAt: DateTime.utc(2026, 11, 21, 10, 6, 59),
      submittedAt: DateTime.utc(2026, 11, 21, 10, 7, 6),
      progress: _progress(
        headline: 'درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود',
        explanation: explanation,
        nextActor: 'PLATFORM_ADMIN',
        nextActorLabel: 'ادامهٔ کار با تأیید ادمین است',
        countLines: const [
          VipProgressCountLine(
            key: 'notYetQueued',
            label: 'هنوز به صف پیام نرسیده',
            count: 100,
          ),
        ],
      ),
    );
    final repo = _ScriptedVipRepository(
      [
        Future.value(VipCapability(
          entitled: true,
          remainingQuota: 400,
          usedQuota: 100,
          activeDraft: draft,
          currentRequest: draft,
        )),
        Future.value(VipCapability(
          entitled: true,
          remainingQuota: 400,
          usedQuota: 100,
          inProgressRequests: [submitted],
        )),
      ],
      submitResult: submitted,
    );
    await _pumpSalon(tester, repo);
    await tester.tap(find.text(AppStrings.vipSubmit));
    await tester.pumpAndSettle();
    expect(repo.submitCalls, 1);
    expect(find.text('VIP-01-01'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRequested}: 100'), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRecordedSends}: 0'), findsOneWidget);
    expect(find.text('درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود'), findsNothing);
    expect(find.text('ادامهٔ کار با تأیید ادمین است'), findsNothing);
    expect(find.text('هنوز به صف پیام نرسیده: ۱۰۰'), findsNothing);
    expect(find.text(explanation), findsNothing);
    expect(find.textContaining('به معنای ارسال یا تحویل پیام نیست'), findsNothing);
    expect(find.text(AppStrings.vipDesiredRegion), findsNothing);
    expect(find.text(AppStrings.vipOrderSummary), findsNothing);
    expect(find.text(AppStrings.sendMessageAction), findsNothing);
    expect(find.byKey(const Key('vip-submit')), findsNothing);
    expect(find.text(AppStrings.vipAddSample), findsNothing);
    expect(find.text(AppStrings.vipStartNewRequest), findsOneWidget);
    expect(find.text(AppStrings.recordVisitIntention), findsOneWidget);

    await tester.tap(find.text(AppStrings.vipStartNewRequest));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
    expect(find.text(AppStrings.vipOrderSummary), findsOneWidget);
    expect(find.byKey(const Key('vip-submit')), findsOneWidget);
    expect(find.text('${AppStrings.vipHistoryRequested}: 100'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text(AppStrings.vipDesiredRegion)).dy <
          tester.getTopLeft(find.text('${AppStrings.vipHistoryRequested}: 100')).dy,
      isTrue,
    );
  });

  testWidgets('a failed submit keeps the draft sample and submit controls', (
    tester,
  ) async {
    final draft = _request(
      id: 'draft',
      status: 'AWAITING_SAMPLE_WORK',
      sampleWorks: const [
        VipSampleWork(
          id: 'sw1',
          position: 1,
          contentType: 'image/jpeg',
          byteSize: 12,
        ),
      ],
      progress: _progress(
        headline: 'در انتظار ارسال نمونه‌کارهای شما',
        explanation: 'سالن باید نمونه کار را بارگذاری کند.',
        nextActor: 'SALON',
        nextActorLabel: 'اقدام بعدی با سالن است',
        reservationStillValid: true,
      ),
    );
    final capability = VipCapability(
      entitled: true,
      remainingQuota: 400,
      usedQuota: 100,
      activeDraft: draft,
      currentRequest: draft,
    );
    final repo = _ScriptedVipRepository(
      [Future.value(capability), Future.value(capability)],
      submitError: const ApiException(
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Sample work is required before submit.',
      ),
    );
    await _pumpSalon(tester, repo);
    await tester.tap(find.text(AppStrings.vipSubmit));
    await tester.pumpAndSettle();
    expect(repo.submitCalls, 1);
    expect(find.text(AppStrings.vipAddSample), findsOneWidget);
    expect(find.text(AppStrings.vipSubmit), findsOneWidget);
    expect(find.text('در انتظار ارسال نمونه‌کارهای شما'), findsOneWidget);
    expect(find.text(AppStrings.vipDesiredRegion), findsNothing);
    expect(find.text(AppStrings.vipOrderSummary), findsNothing);
    expect(find.byKey(const Key('vip-submit')), findsNothing);
  });
}
