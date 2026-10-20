import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/routing/app_router.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/widgets/app_widgets.dart';
import 'package:salon_mobile/features/activation/activation_repository.dart';
import 'package:salon_mobile/features/admin/admin_activation_receipts_screen.dart';
import 'package:salon_mobile/shared/labels.dart';

class _FakeActivation extends ActivationRepository {
  _FakeActivation()
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  int approvals = 0;
  int rejections = 0;
  int listCalls = 0;
  int pageSize = 50;
  int failNextPages = 0;
  String? reason;
  String? attestation;
  Object? imageError;
  String? corruptId;
  final List<ActivationReceiptFilter> listFilters = [];
  final List<String?> listCursors = [];
  final Map<String, Completer<void>> _holds = {};
  final Map<String, ActivationReceiptReview> reviewOverrides = {};
  List<ActivationReceiptSummary> submitted = const [
    ActivationReceiptSummary(
      id: 'receipt-1',
      phase: 'UNDER_REVIEW',
      submittedAt: '2026-10-15T12:00:00.000Z',
      salonName: 'سالن نرگس',
      ownerName: 'نرگس رضایی',
    ),
  ];

  Completer<void> hold(ActivationReceiptFilter filter) {
    final gate = Completer<void>();
    _holds[filter.phase ?? 'all'] = gate;
    return gate;
  }

  @override
  Future<ActivationReceiptPage> list({
    required ActivationReceiptFilter filter,
    String? cursor,
  }) async {
    listCalls += 1;
    listFilters.add(filter);
    listCursors.add(cursor);
    final gate = _holds[filter.phase ?? 'all'];
    if (gate != null) {
      await gate.future;
      _holds.remove(filter.phase ?? 'all');
    }
    if (cursor != null && failNextPages > 0) {
      failNextPages -= 1;
      throw const ApiException(
        statusCode: 503,
        code: 'INFRASTRUCTURE_ERROR',
        message: 'بارگذاری ناموفق بود.',
      );
    }
    final matched = submitted
        .where((item) => filter.phase == null || item.phase == filter.phase)
        .toList();
    final offset = cursor == null ? 0 : int.parse(cursor.split('-').last);
    final end = offset + pageSize < matched.length ? offset + pageSize : matched.length;
    final items = matched.sublist(offset, end);
    final hasMore = end < matched.length;
    return ActivationReceiptPage(
      items: items,
      hasMore: hasMore,
      nextCursor: hasMore ? 'cursor-$end' : null,
    );
  }

  @override
  Future<ActivationReceiptReview> review(String id) async {
    final override = reviewOverrides[id];
    if (override != null) {
      return override;
    }
    return ActivationReceiptReview(
      id: id,
      phase: 'UNDER_REVIEW',
      submittedAt: '2026-10-15T12:00:00.000Z',
      salonName: 'سالن نرگس',
      ownerName: 'نرگس رضایی',
      agreementVersionKey: 'CONTRACT_V1',
      amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال',
      cardNumber: '5859471121191492',
      cardholderName: 'امیر محمد پناهی',
      notice: 'ثبت تصویر فیش به‌تنهایی به معنی تأیید واریز نیست. مدیر پلتفرم واریز بانکی را بررسی می‌کند.',
      requiredBankAttestation: 'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام',
    );
  }

  @override
  Future<List<int>> image(String id) async {
    final error = imageError;
    if (error != null) {
      throw error;
    }
    if (id == corruptId) {
      return const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x11, 0x22, 0x33];
    }
    return base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      );
  }

  @override
  Future<void> approve({
    required String id,
    required String idempotencyKey,
    required String bankAttestation,
  }) async {
    approvals += 1;
    attestation = bankAttestation;
    submitted = submitted.where((item) => item.id != id).toList();
  }

  @override
  Future<void> reject({
    required String id,
    required String reason,
    required String idempotencyKey,
  }) async {
    rejections += 1;
    this.reason = reason;
    submitted = submitted.where((item) => item.id != id).toList();
  }
}

void main() {
  testWidgets('lists a pending receipt and requires a reason before rejection', (tester) async {
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation();
    final router = _receiptRouter();
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [activationRepositoryProvider.overrideWithValue(fake)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.adminActivationReceipts), findsWidgets);
    expect(find.text('سالن نرگس'), findsOneWidget);
    expect(find.text('نرگس رضایی'), findsOneWidget);
    expect(find.byKey(const Key('activation-phase-receipt-1')), findsOneWidget);

    await tester.tap(find.byKey(const Key('activation-receipt-receipt-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin-receipt-image')), findsOneWidget);
    expect(find.text('CONTRACT_V1'), findsOneWidget);
    expect(find.text('۵۰٬۰۰۰٬۰۰۰ ریال'), findsOneWidget);
    expect(find.byKey(const Key('activation-approve')), findsOneWidget);
    expect(find.text('واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام'), findsOneWidget);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).value, isFalse);
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNull);

    await tester.tap(find.byKey(const Key('activation-reject')));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextButton>(find.byKey(const Key('activation-reject-confirm'))).onPressed,
      isNull,
    );
    await tester.enterText(find.byKey(const Key('activation-reject-reason')), 'مبلغ نادرست است');
    await tester.pump();
    await tester.tap(find.byKey(const Key('activation-reject-confirm')));
    await tester.pumpAndSettle();
    expect(fake.rejections, 1);
    expect(fake.reason, 'مبلغ نادرست است');
    expect(fake.approvals, 0);
    expect(find.byKey(const Key('activation-phase-receipt-1')), findsNothing);
    expect(find.text('فیشی ثبت نشده است.'), findsOneWidget);
    expect(fake.listCalls, greaterThan(1));
  });

  testWidgets(
    'enables activation only after the receipt is shown and the bank attestation is checked',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      final fake = _FakeActivation();
      await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts/receipt-1'));
      await _settleReceiptImage(tester);
      expect(find.byKey(const Key('admin-receipt-image')), findsOneWidget);
      expect(
        tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed,
        isNull,
      );

      await tester.tap(find.byKey(const Key('activation-bank-attestation')));
      await tester.pump();
      expect(
        tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(const Key('activation-approve')));
      await tester.pumpAndSettle();
      expect(fake.approvals, 1);
      expect(fake.attestation, 'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام');
      expect(fake.rejections, 0);
      expect(find.byKey(const Key('activation-phase-receipt-1')), findsNothing);
      expect(find.text('فیشی ثبت نشده است.'), findsOneWidget);
    },
  );

  testWidgets('reloads the pending list when navigating back from a receipt detail', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation();
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts'));
    await tester.pumpAndSettle();
    final listsBeforeOpen = fake.listCalls;
    await tester.tap(find.byKey(const Key('activation-receipt-receipt-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin-receipt-image')), findsOneWidget);
    // Another actor cleared the queue while the detail was open.
    fake.submitted = const [];
    final back = find.byType(BackButton);
    expect(back, findsOneWidget);
    await tester.tap(back);
    await tester.pumpAndSettle();
    expect(fake.listCalls, greaterThan(listsBeforeOpen));
    expect(find.byKey(const Key('activation-phase-receipt-1')), findsNothing);
    expect(find.text('فیشی ثبت نشده است.'), findsOneWidget);
  });

  testWidgets('keeps activation disabled when the receipt image cannot be shown', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..imageError = const ApiException(
        statusCode: 503,
        code: 'INFRASTRUCTURE_ERROR',
        message: 'تصویر خوانده نشد.',
      );
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts/receipt-1'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin-receipt-image')), findsNothing);
    expect(find.text('واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام'), findsOneWidget);
    await tester.tap(find.byKey(const Key('activation-bank-attestation')));
    await tester.pump();
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNull);
    expect(fake.approvals, 0);
  });

  testWidgets(
    'keeps approval disabled when the receipt image fails to render and resets for the next receipt',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      final fake = _FakeActivation()..corruptId = 'receipt-bad';
      final router = GoRouter(
        initialLocation: '/admin/activation-receipts/receipt-1',
        routes: [
          GoRoute(
            path: '/admin/activation-receipts',
            builder: (context, state) => const AdminActivationReceiptsScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (context, state) =>
                    AdminActivationReceiptScreen(receiptId: state.pathParameters['id']!),
              ),
            ],
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [activationRepositoryProvider.overrideWithValue(fake)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await _settleReceiptImage(tester);
      expect(
        tester
            .widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation')))
            .onChanged,
        isNotNull,
      );
      await tester.tap(find.byKey(const Key('activation-bank-attestation')));
      await tester.pump();
      expect(
        tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).value,
        isTrue,
      );

      router.go('/admin/activation-receipts/receipt-bad');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('admin-receipt-image-error')), findsOneWidget);
      expect(find.text('تصویر فیش قابل نمایش نیست.'), findsOneWidget);
      expect(
        tester
            .widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation')))
            .onChanged,
        isNull,
      );
      expect(
        tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).value,
        isFalse,
      );
      expect(
        tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed,
        isNull,
      );
      expect(
        tester.widget<OutlinedButton>(find.byKey(const Key('activation-reject'))).onPressed,
        isNotNull,
      );
      expect(fake.approvals, 0);
    },
  );

  testWidgets('switches between all four server-backed receipt views', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..submitted = [
        _summary('u1', 'UNDER_REVIEW'),
        _summary('u2', 'UNDER_REVIEW'),
        _summary('a1', 'APPROVED'),
        _summary('r1', 'REJECTED'),
      ];
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('activation-receipt-u1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-u2')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-a1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-r1')), findsOneWidget);
    expect(
      tester.widget<ChoiceChip>(find.byKey(const Key('activation-filter-all'))).selected,
      isTrue,
    );

    await tester.tap(find.byKey(const Key('activation-filter-under-review')));
    await tester.pumpAndSettle();
    expect(fake.listFilters.last, ActivationReceiptFilter.underReview);
    expect(find.byKey(const Key('activation-receipt-u1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-u2')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-a1')), findsNothing);
    expect(find.byKey(const Key('activation-receipt-r1')), findsNothing);

    await tester.tap(find.byKey(const Key('activation-filter-approved')));
    await tester.pumpAndSettle();
    expect(fake.listFilters.last, ActivationReceiptFilter.approved);
    expect(find.byKey(const Key('activation-receipt-a1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-u1')), findsNothing);
    expect(find.byKey(const Key('activation-receipt-r1')), findsNothing);

    await tester.tap(find.byKey(const Key('activation-filter-rejected')));
    await tester.pumpAndSettle();
    expect(fake.listFilters.last, ActivationReceiptFilter.rejected);
    expect(find.byKey(const Key('activation-receipt-r1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-a1')), findsNothing);
    expect(find.byKey(const Key('activation-receipt-u1')), findsNothing);

    await tester.tap(find.byKey(const Key('activation-filter-all')));
    await tester.pumpAndSettle();
    expect(fake.listFilters.last, ActivationReceiptFilter.all);
    expect(find.byKey(const Key('activation-receipt-a1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-r1')), findsOneWidget);
  });

  testWidgets('loads a second server page so older receipts stay reachable', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..submitted = [
        for (var index = 1; index <= 51; index += 1) _summary('u$index', 'UNDER_REVIEW'),
      ];
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts'));
    await tester.pumpAndSettle();

    expect(fake.listCalls, 1);
    expect(find.byKey(const Key('activation-receipt-u51')), findsNothing);
    await tester.scrollUntilVisible(
      find.byKey(const Key('activation-load-more')),
      500,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.byKey(const Key('activation-load-more')), findsOneWidget);

    await tester.tap(find.byKey(const Key('activation-load-more')));
    await tester.pumpAndSettle();
    expect(fake.listCalls, 2);
    expect(fake.listCursors.last, 'cursor-50');
    expect(find.byKey(const Key('activation-load-more')), findsNothing);
    await tester.scrollUntilVisible(
      find.byKey(const Key('activation-receipt-u51')),
      400,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.byKey(const Key('activation-receipt-u51')), findsOneWidget);
  });

  testWidgets('keeps loaded receipts and filter when the next page fails and retries it', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..submitted = [
        for (var index = 1; index <= 51; index += 1) _summary('u$index', 'UNDER_REVIEW'),
      ]
      ..failNextPages = 1;
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('activation-filter-under-review')));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('activation-load-more')),
      500,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.byKey(const Key('activation-load-more')));
    await tester.pumpAndSettle();

    expect(
      tester.widget<ChoiceChip>(find.byKey(const Key('activation-filter-under-review'))).selected,
      isTrue,
    );
    expect(find.byKey(const Key('activation-receipt-u50')), findsOneWidget);
    expect(find.byKey(const Key('activation-load-more-error')), findsOneWidget);
    expect(find.byKey(const Key('activation-load-more-retry')), findsOneWidget);
    expect(find.text('فیشی در انتظار بررسی نیست.'), findsNothing);
    expect(fake.listCursors.last, 'cursor-50');

    await tester.tap(find.byKey(const Key('activation-load-more-retry')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('activation-load-more-error')), findsNothing);
    expect(fake.listCursors.last, 'cursor-50');
    expect(
      tester.widget<ChoiceChip>(find.byKey(const Key('activation-filter-under-review'))).selected,
      isTrue,
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('activation-receipt-u51')),
      400,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.byKey(const Key('activation-receipt-u51')), findsOneWidget);
  });

  testWidgets('a rapid filter change ignores the older response', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..submitted = [
        _summary('u1', 'UNDER_REVIEW'),
        _summary('a1', 'APPROVED'),
        _summary('r1', 'REJECTED'),
      ];
    final approvedGate = fake.hold(ActivationReceiptFilter.approved);
    final rejectedGate = fake.hold(ActivationReceiptFilter.rejected);
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('activation-filter-approved')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('activation-filter-rejected')));
    await tester.pump();

    rejectedGate.complete();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('activation-receipt-r1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-a1')), findsNothing);

    approvedGate.complete();
    await tester.pumpAndSettle();
    expect(fake.listFilters.last, ActivationReceiptFilter.rejected);
    expect(find.byKey(const Key('activation-receipt-r1')), findsOneWidget);
    expect(find.byKey(const Key('activation-receipt-a1')), findsNothing);
  });

  testWidgets('decided receipts show decision details and no actions', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..reviewOverrides['a1'] = const ActivationReceiptReview(
        id: 'a1',
        phase: 'APPROVED',
        submittedAt: '2026-10-15T12:00:00.000Z',
        decidedAt: '2026-10-15T13:00:00.000Z',
        salonName: 'سالن نرگس',
        ownerName: 'نرگس رضایی',
        agreementVersionKey: 'CONTRACT_V1',
        amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال',
        cardNumber: '5859471121191492',
        cardholderName: 'امیر محمد پناهی',
        notice: 'ثبت تصویر فیش به‌تنهایی به معنی تأیید واریز نیست.',
        requiredBankAttestation: '',
        bankAttestationWording: 'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام',
      )
      ..reviewOverrides['r1'] = const ActivationReceiptReview(
        id: 'r1',
        phase: 'REJECTED',
        submittedAt: '2026-10-15T12:00:00.000Z',
        decidedAt: '2026-10-15T13:00:00.000Z',
        salonName: 'سالن نرگس',
        ownerName: 'نرگس رضایی',
        agreementVersionKey: 'CONTRACT_V1',
        amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال',
        cardNumber: '5859471121191492',
        cardholderName: 'امیر محمد پناهی',
        notice: 'ثبت تصویر فیش به‌تنهایی به معنی تأیید واریز نیست.',
        requiredBankAttestation: '',
        rejectionReason: 'مبلغ با قرارداد یکی نیست',
      );

    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts/a1'));
    await _settleReceiptImage(tester);
    expect(find.text('تأیید شده'), findsOneWidget);
    expect(find.byKey(const Key('admin-receipt-decided-at')), findsOneWidget);
    expect(find.byKey(const Key('admin-receipt-attestation')), findsOneWidget);
    expect(find.byKey(const Key('activation-approve')), findsNothing);
    expect(find.byKey(const Key('activation-reject')), findsNothing);
    expect(find.byKey(const Key('activation-bank-attestation')), findsNothing);

    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts/r1'));
    await _settleReceiptImage(tester);
    expect(find.text('رد شده'), findsOneWidget);
    expect(find.byKey(const Key('admin-receipt-reason')), findsOneWidget);
    expect(find.text('مبلغ با قرارداد یکی نیست'), findsOneWidget);
    expect(find.byKey(const Key('activation-approve')), findsNothing);
    expect(find.byKey(const Key('activation-reject')), findsNothing);
  });

  testWidgets('refreshes after a decision and preserves the selected filter', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..submitted = [_summary('receipt-1', 'UNDER_REVIEW'), _summary('a1', 'APPROVED')];
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('activation-filter-under-review')));
    await tester.pumpAndSettle();
    expect(fake.listFilters.last, ActivationReceiptFilter.underReview);

    await tester.tap(find.byKey(const Key('activation-receipt-receipt-1')));
    await _settleReceiptImage(tester);
    await tester.tap(find.byKey(const Key('activation-bank-attestation')));
    await tester.pump();
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('activation-approve')));
    await tester.pumpAndSettle();

    expect(fake.approvals, 1);
    expect(fake.listFilters.last, ActivationReceiptFilter.underReview);
    expect(fake.listCursors.last, isNull);
    expect(
      tester.widget<ChoiceChip>(find.byKey(const Key('activation-filter-under-review'))).selected,
      isTrue,
    );
    expect(find.byKey(const Key('activation-receipt-a1')), findsNothing);
    expect(find.byKey(const Key('activation-receipt-receipt-1')), findsNothing);
    expect(find.text('فیشی در انتظار بررسی نیست.'), findsOneWidget);
  });
}

ActivationReceiptSummary _summary(String id, String phase) {
  return ActivationReceiptSummary(
    id: id,
    phase: phase,
    submittedAt: '2026-10-15T12:00:00.000Z',
    salonName: 'سالن $id',
    ownerName: 'نرگس رضایی',
  );
}

Future<void> _settleReceiptImage(WidgetTester tester) async {
  await tester.pumpAndSettle();
  final imageFinder = find.byKey(const Key('admin-receipt-image'));
  if (imageFinder.evaluate().isNotEmpty) {
    final image = tester.widget<Image>(imageFinder);
    try {
      await tester.runAsync(() => precacheImage(image.image, tester.element(imageFinder)));
    } catch (_) {}
  }
  await tester.pumpAndSettle();
}

GoRouter _receiptRouter({String initialLocation = '/admin/activation-receipts'}) {
  return GoRouter(
    initialLocation: initialLocation,
    observers: [adminRouteObserver],
    routes: [
      GoRoute(
        path: '/admin/activation-receipts',
        builder: (context, state) => const AdminActivationReceiptsScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (context, state) => AdminActivationReceiptScreen(
              receiptId: state.pathParameters['id']!,
            ),
          ),
        ],
      ),
    ],
  );
}

Widget _adminApp(_FakeActivation fake, String location) {
  final router = _receiptRouter(initialLocation: location);
  return ProviderScope(
    overrides: [activationRepositoryProvider.overrideWithValue(fake)],
    child: MaterialApp.router(routerConfig: router),
  );
}
