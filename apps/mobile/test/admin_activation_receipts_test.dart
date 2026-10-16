import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
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
  String? reason;
  String? attestation;
  Object? imageError;
  String? corruptId;

  @override
  Future<List<ActivationReceiptSummary>> listPending() async {
    return const [
      ActivationReceiptSummary(
        id: 'receipt-1',
        phase: 'UNDER_REVIEW',
        submittedAt: '2026-10-15T12:00:00.000Z',
        salonName: 'سالن نرگس',
        ownerName: 'نرگس رضایی',
      ),
    ];
  }

  @override
  Future<ActivationReceiptReview> review(String id) async {
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
  }

  @override
  Future<void> reject({
    required String id,
    required String reason,
    required String idempotencyKey,
  }) async {
    rejections += 1;
    this.reason = reason;
  }
}

void main() {
  testWidgets('lists a pending receipt and requires a reason before rejection', (tester) async {
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation();
    final router = GoRouter(
      initialLocation: '/admin/activation-receipts',
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
    expect(find.text('در انتظار بررسی'), findsOneWidget);

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
  });

  testWidgets('enables activation only after the receipt is shown and the bank attestation is checked', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation();
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts/receipt-1'));
    await _settleReceiptImage(tester);
    expect(find.byKey(const Key('admin-receipt-image')), findsOneWidget);
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNull);

    await tester.tap(find.byKey(const Key('activation-bank-attestation')));
    await tester.pump();
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('activation-approve')));
    await tester.pumpAndSettle();
    expect(fake.approvals, 1);
    expect(fake.attestation, 'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام');
    expect(fake.rejections, 0);
  });

  testWidgets('keeps activation disabled when the receipt image cannot be shown', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeActivation()
      ..imageError = const ApiException(statusCode: 503, code: 'INFRASTRUCTURE_ERROR', message: 'تصویر خوانده نشد.');
    await tester.pumpWidget(_adminApp(fake, '/admin/activation-receipts/receipt-1'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin-receipt-image')), findsNothing);
    expect(find.text('واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام'), findsOneWidget);
    await tester.tap(find.byKey(const Key('activation-bank-attestation')));
    await tester.pump();
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNull);
    expect(fake.approvals, 0);
  });

  testWidgets('keeps approval disabled when the receipt image fails to render and resets for the next receipt', (tester) async {
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
              builder: (context, state) => AdminActivationReceiptScreen(
                receiptId: state.pathParameters['id']!,
              ),
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
      tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).onChanged,
      isNotNull,
    );
    await tester.tap(find.byKey(const Key('activation-bank-attestation')));
    await tester.pump();
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).value, isTrue);

    router.go('/admin/activation-receipts/receipt-bad');
    await _settleReceiptImage(tester);
    expect(find.byKey(const Key('admin-receipt-image-error')), findsOneWidget);
    expect(find.text('تصویر فیش قابل نمایش نیست.'), findsOneWidget);
    expect(
      tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).onChanged,
      isNull,
    );
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('activation-bank-attestation'))).value, isFalse);
    expect(tester.widget<AppButton>(find.byKey(const Key('activation-approve'))).onPressed, isNull);
    expect(tester.widget<OutlinedButton>(find.byKey(const Key('activation-reject'))).onPressed, isNotNull);
    expect(fake.approvals, 0);
  });
}

Future<void> _settleReceiptImage(WidgetTester tester) async {
  await tester.pump();
  final imageFinder = find.byKey(const Key('admin-receipt-image'));
  if (imageFinder.evaluate().isNotEmpty) {
    final image = tester.widget<Image>(imageFinder);
    try {
      await tester.runAsync(() => precacheImage(image.image, tester.element(imageFinder)));
    } catch (_) {}
  }
  await tester.pumpAndSettle();
}

Widget _adminApp(_FakeActivation fake, String location) {
  final router = GoRouter(
    initialLocation: location,
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
  return ProviderScope(
    overrides: [activationRepositoryProvider.overrideWithValue(fake)],
    child: MaterialApp.router(routerConfig: router),
  );
}
