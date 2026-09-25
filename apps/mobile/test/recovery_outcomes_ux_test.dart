import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/core/widgets/app_widgets.dart';
import 'package:salon_mobile/features/recovery/recovery_outcomes_screen.dart';
import 'package:salon_mobile/shared/jalali.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(
    baseUrl: 'http://example.test',
    sessionStore: MemorySessionStore(),
  );
}

RecoveryOutcomesSummary _summary({
  required DateTime start,
  required DateTime end,
  required bool current,
  int sent = 0,
  int commitments = 0,
  int backed = 0,
  int observed = 0,
  AssociatedRevenue? revenue,
}) {
  return RecoveryOutcomesSummary(
    period: RecoveryOutcomesPeriod(
      timezone: 'Asia/Tehran',
      start: start,
      end: end,
      previousWeekStart: start.subtract(const Duration(days: 7)),
      nextWeekStart: end,
      current: current,
    ),
    sentFollowUps: sent,
    returnCommitmentsRecorded: commitments,
    commitmentBackedReturns: backed,
    commitmentBackedRecordedRevenue: revenue ??
        const AssociatedRevenue(recorded: false, currency: 'IRR'),
    observedReturns: observed,
  );
}

class FakeRecoveryRepo extends ReturnCommitmentRepository {
  FakeRecoveryRepo({
    this.summary,
    this.error,
    this.backed = const [],
    this.observed = const [],
    this.open = const [],
    this.backedPages,
  }) : super(_client());

  RecoveryOutcomesSummary? summary;
  Object? error;
  List<RecoveryOutcomeReturnItem> backed;
  List<RecoveryOutcomeReturnItem> observed;
  List<OpenAgreedReturn> open;
  Map<String?, ItemPage<RecoveryOutcomeReturnItem>>? backedPages;
  bool failBackedNextOnce = false;
  final List<String?> backedCursors = [];
  DateTime? lastRequestedWeekStart;

  @override
  Future<RecoveryOutcomesSummary> outcomesSummary({DateTime? weekStart}) async {
    lastRequestedWeekStart = weekStart?.toUtc();
    if (error != null) {
      throw error!;
    }
    return summary!;
  }

  @override
  Future<ItemPage<RecoveryOutcomeReturnItem>> outcomeReturns({
    required String kind,
    DateTime? weekStart,
    String? cursor,
  }) async {
    if (kind == 'COMMITMENT_BACKED') {
      backedCursors.add(cursor);
      if (cursor != null && failBackedNextOnce) {
        failBackedNextOnce = false;
        throw const ApiException(statusCode: 503, code: 'UNAVAILABLE', message: 'retry');
      }
      final page = backedPages?[cursor];
      if (page != null) return page;
    }
    final items = kind == 'COMMITMENT_BACKED' ? backed : observed;
    return ItemPage(items: items, hasMore: false);
  }

  @override
  Future<ItemPage<OpenAgreedReturn>> listOpen({String? cursor}) async {
    return ItemPage(items: open, hasMore: false);
  }
}

Widget _app(FakeRecoveryRepo repo) {
  return ProviderScope(
    overrides: [
      returnCommitmentRepositoryProvider.overrideWithValue(repo),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      locale: const Locale('fa'),
      supportedLocales: const [Locale('fa')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const RecoveryOutcomesScreen(),
    ),
  );
}

void main() {
  final weekStart = DateTime.parse('2026-09-11T20:30:00.000Z');
  final weekEnd = DateTime.parse('2026-09-18T20:30:00.000Z');

  test('owner week labels use Asia/Tehran wall dates', () {
    expect(
      formatOwnerBusinessWeekLabel(weekStart, weekEnd),
      '۲۱ شهریور ۱۴۰۵ — ۲۷ شهریور ۱۴۰۵',
    );
  });

  testWidgets('shows loading then empty state', (tester) async {
    final repo = FakeRecoveryRepo(
      summary: _summary(start: weekStart, end: weekEnd, current: true),
    );
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.recoveryOutcomesEmpty), findsOneWidget);
    expect(find.text(AppStrings.recoveryOutcomesTitle), findsOneWidget);
  });

  testWidgets('shows error state', (tester) async {
    final repo = FakeRecoveryRepo(
      error: const ApiException(statusCode: 500, code: 'INTERNAL', message: 'boom'),
    );
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    expect(find.byType(ErrorView), findsOneWidget);
  });

  testWidgets('populated state keeps evidence kinds separate and one revenue number', (
    tester,
  ) async {
    final repo = FakeRecoveryRepo(
      summary: _summary(
        start: weekStart,
        end: weekEnd,
        current: true,
        sent: 4,
        commitments: 2,
        backed: 1,
        observed: 1,
        revenue: const AssociatedRevenue(
          recorded: true,
          currency: 'IRR',
          amount: '150.50',
        ),
      ),
      backed: [
        RecoveryOutcomeReturnItem(
          associationKind: 'COMMITMENT_BACKED',
          customerId: 'c1',
          customerName: 'سارا احمدی',
          visitId: 'v1',
          visitedAt: DateTime.parse('2026-09-13T10:00:00.000Z'),
          associatedRevenue: const AssociatedRevenue(
            recorded: true,
            currency: 'IRR',
            amount: '150.50',
          ),
        ),
      ],
      observed: [
        RecoveryOutcomeReturnItem(
          associationKind: 'OBSERVED',
          customerId: 'c2',
          customerName: 'مینا رضایی',
          visitId: 'v2',
          visitedAt: DateTime.parse('2026-09-17T10:00:00.000Z'),
          associatedRevenue: const AssociatedRevenue(
            recorded: true,
            currency: 'IRR',
            amount: '80.00',
          ),
        ),
      ],
    );
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    expect(find.text(formatOwnerBusinessWeekLabel(weekStart, weekEnd)), findsOneWidget);
    expect(find.text(AppStrings.recoverySentFollowUps), findsOneWidget);
    expect(find.text(AppStrings.recoveryCommitmentsRecorded), findsOneWidget);
    expect(find.text(AppStrings.recoveryCommitmentBackedReturns), findsWidgets);
    expect(find.text(AppStrings.recoveryCommitmentBackedRevenue), findsOneWidget);
    await tester.scrollUntilVisible(find.text(AppStrings.recoveryObservedWeaker), 300);
    expect(find.text(AppStrings.recoveryObservedReturns), findsWidgets);
    expect(find.text(AppStrings.recoveryObservedWeaker), findsOneWidget);
    expect(find.textContaining('۱۵۰.۵۰'), findsWidgets);
    expect(find.textContaining('۸۰.۰۰'), findsNothing);
    expect(find.textContaining('ROI'), findsNothing);
    expect(find.textContaining('نرخ'), findsNothing);
    expect(find.text('سارا احمدی'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('مینا رضایی'), 300);
    expect(find.text('مینا رضایی'), findsOneWidget);
  });

  testWidgets('previous week navigation requests the server weekStart', (tester) async {
    final previous = DateTime.parse('2026-09-04T20:30:00.000Z');
    final repo = FakeRecoveryRepo(
      summary: _summary(start: weekStart, end: weekEnd, current: true, sent: 1),
    );
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    repo.summary = _summary(
      start: previous,
      end: weekStart,
      current: false,
      sent: 0,
    );
    await tester.tap(find.text(AppStrings.recoveryPreviousWeek));
    await tester.pumpAndSettle();
    expect(repo.lastRequestedWeekStart, previous);
    expect(find.text(AppStrings.recoveryCurrentWeek), findsOneWidget);
  });

  testWidgets('recovery outcomes expose open agreed-return customers', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final repo = FakeRecoveryRepo(
      summary: _summary(start: weekStart, end: weekEnd, current: true),
      open: [
        OpenAgreedReturn(
          id: 'o1',
          customerId: 'c1',
          customerName: 'عرفان صابری',
          customerPhone: '09125222222',
          expectedAt: DateTime.utc(2026, 9, 20, 10),
          overdue: true,
          recordedBySupport: true,
        ),
      ],
    );
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.openAgreedReturnsTitle), findsOneWidget);
    expect(find.text('عرفان صابری'), findsOneWidget);
    expect(find.text('09125222222'), findsOneWidget);
    expect(find.text(AppStrings.recordedBySupport), findsOneWidget);
    expect(find.text(AppStrings.agreedTimePast), findsOneWidget);
    expect(find.text(AppStrings.callCustomer), findsOneWidget);
  });

  testWidgets('later evidence page retries without losing first-page rows', (tester) async {
    tester.view.physicalSize = const Size(800, 1900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    RecoveryOutcomeReturnItem item(String id, String name) => RecoveryOutcomeReturnItem(
      associationKind: 'COMMITMENT_BACKED', customerId: id, customerName: name,
      visitId: id, visitedAt: DateTime.parse('2026-09-13T10:00:00.000Z'),
      associatedRevenue: const AssociatedRevenue(recorded: false, currency: 'IRR'),
    );
    final repo = FakeRecoveryRepo(
      summary: _summary(start: weekStart, end: weekEnd, current: true, backed: 2),
      backedPages: {
        null: ItemPage(items: [item('v1', 'First page customer')], hasMore: true, nextCursor: 'next'),
        'next': ItemPage(items: [item('v2', 'Second page customer')], hasMore: false),
      },
    )..failBackedNextOnce = true;
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    expect(find.text('First page customer'), findsOneWidget);
    expect(find.text('Second page customer'), findsNothing);
    await tester.ensureVisible(find.text(AppStrings.loadMore));
    await tester.tap(find.text(AppStrings.loadMore));
    await tester.pumpAndSettle();
    expect(find.text('First page customer'), findsOneWidget);
    expect(find.byType(ErrorView), findsOneWidget);
    await tester.tap(find.text(AppStrings.retry));
    await tester.pumpAndSettle();
    expect(find.text('First page customer'), findsOneWidget);
    expect(find.text('Second page customer'), findsOneWidget);
    expect(repo.backedCursors, [null, 'next', 'next']);
    expect(find.text(AppStrings.loadMore), findsNothing);
  });
}
