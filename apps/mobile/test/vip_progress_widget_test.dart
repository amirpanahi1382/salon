import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/vip/salon_vip_section.dart';
import 'package:salon_mobile/features/vip/vip_progress_card.dart';
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
}) {
  return VipRequest(
    id: id,
    salonId: 'salon-a',
    salonName: 'سالن آزمایش',
    listId: 'list-$id',
    listName: listName,
    requestedCount: 30,
    geographicRange: 'ونک',
    status: status,
    progress: progress,
  );
}

class _ScriptedVipRepository extends VipRepository {
  _ScriptedVipRepository(this.capabilities) : super(_client());

  final List<Future<VipCapability>> capabilities;
  int index = 0;

  @override
  Future<VipCapability> capability() {
    return capabilities[index++];
  }

  @override
  Future<List<VipRegion>> regions() async => const [];
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
      expect(find.text(progress.explanation), findsOneWidget);
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
    expect(find.text('${AppStrings.vipListNameLabel}: ${draft.listName}'), findsOneWidget);
    expect(find.text(AppStrings.vipRequestedRecipientCount(draft.requestedCount)), findsOneWidget);
    expect(find.textContaining('نه اینکه پیامی در حال ارسال باشد'), findsOneWidget);
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
      progress: _progress(
        headline: 'درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود',
        explanation: 'درخواست منتظر تأیید ادمین است.',
        nextActor: 'PLATFORM_ADMIN',
        nextActorLabel: 'ادامهٔ کار با تأیید ادمین است',
        countLines: const [
          VipProgressCountLine(key: 'notYetQueued', label: 'هنوز به صف پیام نرسیده', count: 30),
        ],
      ),
    );
    final manual = _request(
      id: 'manual',
      status: 'MANUAL_QUEUED',
      listName: 'فهرست دستی',
      progress: _progress(
        headline: 'درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید',
        explanation: 'کل درخواست ارسال‌شده نیست.',
        nextActor: 'PLATFORM_ADMIN',
        nextActorLabel: 'ادامهٔ کار با تأیید ادمین است',
        countLines: const [
          VipProgressCountLine(key: 'durablySkipped', label: 'برای این درخواست دیگر پیام نمی‌گیرد', count: 2),
        ],
        activeStopNote: 'توقف فعال جدا از ارسال‌نشدن همین درخواست است.',
      ),
    );
    final cancelled = _request(
      id: 'cancelled',
      status: 'CANCELLED',
      listName: 'فهرست لغوشده',
      progress: _progress(
        headline: 'اتمام مهلت ارسال درخواست',
        explanation: 'این پایان مهلت پیش‌نویس است، نه ناموفق بودن یک ارسال.',
        nextActor: 'NONE',
        nextActorLabel: 'برای این پیش‌نویس کار دیگری نمانده است',
      ),
    );
    await _pumpSalon(
      tester,
      _ScriptedVipRepository([
        Future.value(VipCapability(
          entitled: true,
          remainingQuota: 400,
          usedQuota: 100,
          inProgressRequests: [submitted, manual],
          latestCancelledRequest: cancelled,
        )),
      ]),
    );
    expect(find.text('درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود'), findsOneWidget);
    expect(find.text('درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید'), findsOneWidget);
    expect(find.text('هنوز به صف پیام نرسیده: ۳۰'), findsOneWidget);
    expect(find.text('برای این درخواست دیگر پیام نمی‌گیرد: ۲'), findsOneWidget);
    expect(find.textContaining('توقف فعال جدا'), findsOneWidget);
    expect(find.text('اتمام مهلت ارسال درخواست'), findsOneWidget);
    expect(find.text('${AppStrings.vipListNameLabel}: فهرست ثبت'), findsOneWidget);
    expect(find.text('${AppStrings.vipListNameLabel}: فهرست دستی'), findsOneWidget);
    expect(find.text('${AppStrings.vipListNameLabel}: فهرست لغوشده'), findsOneWidget);
    expect(find.text('رسیدگی دستی شروع شده'), findsNothing);
    expect(find.text('ارسال با بله در دسترس نیست'), findsNothing);
    expect(find.text(AppStrings.vipAddSample), findsNothing);
    expect(find.textContaining('09120000000'), findsNothing);
    expect(find.textContaining('متن محرمانه'), findsNothing);
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
    newer.complete(VipCapability(
      entitled: true,
      remainingQuota: 500,
      usedQuota: 0,
      inProgressRequests: [
        _request(
          id: 'new',
          status: 'SUBMITTED',
          progress: _progress(
            headline: 'تازه',
            explanation: 'جدید',
            nextActor: 'PLATFORM_ADMIN',
            nextActorLabel: 'اقدام بعدی با پلتفرم است',
          ),
        ),
      ],
    ));
    await newerLoad;
    await tester.pumpAndSettle();
    older.complete(VipCapability(
      entitled: true,
      remainingQuota: 500,
      usedQuota: 0,
      inProgressRequests: [
        _request(
          id: 'old',
          status: 'SUBMITTED',
          progress: _progress(
            headline: 'کهنه',
            explanation: 'قدیمی',
            nextActor: 'PLATFORM_ADMIN',
            nextActorLabel: 'اقدام بعدی با پلتفرم است',
          ),
        ),
      ],
    ));
    await tester.pumpAndSettle();
    expect(find.text('تازه'), findsOneWidget);
    expect(find.text('کهنه'), findsNothing);
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
      _ScriptedVipRepository([
        Future.value(VipCapability(
          entitled: true,
          remainingQuota: 500,
          usedQuota: 0,
          inProgressRequests: const [],
          latestCancelledRequest: cancelled,
        )),
      ]),
    );
    expect(find.text(AppStrings.vipInProgressRequests), findsNothing);
    expect(find.text('اتمام مهلت ارسال درخواست'), findsOneWidget);
    expect(find.text('${AppStrings.vipListNameLabel}: فهرست منقضی'), findsOneWidget);
    expect(find.text(AppStrings.vipRequestedRecipientCount(30)), findsOneWidget);
    expect(find.text(AppStrings.vipDesiredRegion), findsOneWidget);
  });
}
