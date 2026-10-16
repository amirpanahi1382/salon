import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/widgets/app_widgets.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/routing/app_router.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/agreement/agreement_repository.dart';
import 'package:salon_mobile/features/agreement/agreement_screen.dart';
import 'package:salon_mobile/shared/models/models.dart';

const _button = 'تأیید قرارداد و ادامه به راهنمای واریز';
const _readonly = 'مبلغ این قرارداد فقط خواندنی است و ۵۰۰ ارسال قابل‌احتساب دارد.';

class _FakeAgreement extends AgreementRepository {
  _FakeAgreement()
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  int presentCalls = 0;
  int acceptCalls = 0;
  Object? loadError;
  Object? presentError;
  Object? acceptError;
  int loads = 0;
  final List<String> acceptKeys = [];
  final List<String> acceptPresentations = [];
  final List<Completer<void>> presentHolds = [];
  bool holdPresents = false;

  @override
  Future<AgreementContract> current() async {
    loads += 1;
    if (loadError != null && loads == 1) {
      throw loadError!;
    }
    return AgreementContract(
      versionKey: 'CONTRACT_V1',
      templateDigest: 'digest',
      amountIrr: '50000000.00',
      amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان',
      checkboxWording: 'متن پذیرش',
      buttonWording: _button,
      verifiedPhone: '09120000000',
      segments: const [
        AgreementSegment.text('نام و نام خانوادگی: '),
        AgreementSegment.field('fullName'),
        AgreementSegment.text('\nکد ملی: '),
        AgreementSegment.field('nationalId'),
        AgreementSegment.text('\nنام سالن آرایشگاهی: '),
        AgreementSegment.field('salonName'),
        AgreementSegment.text('\nشمارهٔ تماس: '),
        AgreementSegment.field('phone'),
        AgreementSegment.text('\n$_readonly'),
      ],
    );
  }

  @override
  Future<AgreementPreview> present({
    required String fullName,
    required String nationalId,
    required String salonName,
    required String phone,
  }) async {
    presentCalls += 1;
    final presentationId = 'presentation-$presentCalls';
    final canonicalDocument = '$fullName|$nationalId|$salonName|$phone|$_readonly';
    if (holdPresents) {
      final gate = Completer<void>();
      presentHolds.add(gate);
      await gate.future;
    }
    if (presentError != null) {
      throw presentError!;
    }
    return AgreementPreview(
      presentationId: presentationId,
      versionKey: 'CONTRACT_V1',
      renderedDigest: 'rendered',
      amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان',
      buttonWording: _button,
      canonicalDocument: canonicalDocument,
    );
  }

  @override
  Future<AgreementReceipt> receipt() async {
    return const AgreementReceipt(
      versionKey: 'CONTRACT_V1',
      acceptedAt: '2026-10-15T12:00:00.000Z',
      renderedDigest: 'rendered-digest',
      statement: 'Agreement recorded. Payment instructions are not available.',
    );
  }

  @override
  Future<AgreementAcceptanceResult> accept({
    required String presentationId,
    required String idempotencyKey,
  }) async {
    acceptCalls += 1;
    acceptKeys.add(idempotencyKey);
    acceptPresentations.add(presentationId);
    if (acceptError != null) {
      throw acceptError!;
    }
    return const AgreementAcceptanceResult(
      acceptanceId: 'acceptance-1',
      accessState: 'AWAITING_PAYMENT',
      statement: 'Agreement recorded. Payment instructions are not available.',
    );
  }
}

class _SignedInAuth extends AuthController {
  @override
  AuthState build() {
    return const AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(
        id: 'user-1',
        tenantId: 'salon-1',
        role: 'OWNER',
        accessState: 'AWAITING_AGREEMENT',
        sessionScope: 'onboarding',
      ),
    );
  }
}

void main() {
  test('routes phone onboarding without sending a product salon through it', () {
    expect(
      signedInSalonRedirect(
        accessState: 'AWAITING_AGREEMENT',
        sessionScope: 'onboarding',
        location: '/',
      ),
      '/agreement',
    );
    expect(
      signedInSalonRedirect(
        accessState: 'AWAITING_AGREEMENT',
        sessionScope: 'onboarding',
        location: '/agreement',
      ),
      isNull,
    );
    expect(
      signedInSalonRedirect(
        accessState: 'AWAITING_PAYMENT',
        sessionScope: 'onboarding',
        location: '/customers',
      ),
      '/payment',
    );
    expect(
      signedInSalonRedirect(
        accessState: 'AWAITING_PAYMENT',
        sessionScope: 'onboarding',
        location: '/payment',
      ),
      isNull,
    );
    expect(
      signedInSalonRedirect(
        accessState: 'PRODUCT',
        sessionScope: 'onboarding',
        location: '/',
      ),
      '/payment',
    );
    expect(
      signedInSalonRedirect(accessState: 'PRODUCT', sessionScope: 'product', location: '/'),
      isNull,
    );
    expect(
      signedInSalonRedirect(
        accessState: 'PRODUCT',
        sessionScope: 'product',
        location: '/agreement',
      ),
      '/',
    );
    expect(
      shouldExchangeProductSession(
        role: 'OWNER',
        accessState: 'PRODUCT',
        sessionScope: 'onboarding',
      ),
      isTrue,
    );
  });

  testWidgets('shows the server contract, an unchecked box, and only four fields', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    expect(find.text('نسخه CONTRACT_V1'), findsOneWidget);
    expect(find.text('۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان'), findsOneWidget);
    expect(find.text('50000000.00'), findsOneWidget);
    expect(find.textContaining(_readonly), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(4));
    expect(find.widgetWithText(TextField, _readonly), findsNothing);
    final consent = tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent')));
    expect(consent.value, isFalse);
    final button = tester.widget<AppButton>(find.byKey(const Key('agreement-confirm')));
    expect(button.label, _button);
    expect(button.onPressed, isNull);
    expect(fake.presentCalls, 0);

    await tester.enterText(find.byKey(const Key('agreement-full-name')), 'نرگس رضایی');
    await tester.enterText(find.byKey(const Key('agreement-national-id')), '0013542419');
    await tester.enterText(find.byKey(const Key('agreement-salon-name')), 'سالن نرگس');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsOneWidget);
    expect(find.textContaining(_readonly), findsWidgets);

    await tester.enterText(find.byKey(const Key('agreement-phone')), '09121111111');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-phone-unverified')), findsOneWidget);
    final blocked = tester.widget<AppButton>(find.byKey(const Key('agreement-confirm')));
    expect(blocked.onPressed, isNull);

    await tester.enterText(find.byKey(const Key('agreement-phone')), '09120000000');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agreement-consent')));
    await tester.pumpAndSettle();
    final ready = tester.widget<AppButton>(find.byKey(const Key('agreement-confirm')));
    expect(ready.onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('agreement-confirm')));
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, 1);
    final context = tester.element(find.byType(AgreementScreen));
    expect(
      ProviderScope.containerOf(context).read(authControllerProvider).user?.accessState,
      'AWAITING_PAYMENT',
    );
  });

  testWidgets('retries a failed contract load without accepting', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeAgreement()
      ..loadError = const ApiException(statusCode: 503, code: 'HTTP_ERROR', message: 'قطع شد');
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-error')), findsOneWidget);
    await tester.tap(find.byKey(const Key('agreement-retry')));
    await tester.pumpAndSettle();
    expect(find.text('نسخه CONTRACT_V1'), findsOneWidget);
    expect(fake.acceptCalls, 0);
  });

  testWidgets('preview retry does not accept, and acceptance retry repeats the same attempt', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeAgreement()
      ..presentError = const NetworkException('preview failed');
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await _fillDeclaredFields(tester);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsNothing);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).onChanged, isNull);
    await tester.tap(find.byKey(const Key('agreement-retry')));
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, 0);

    fake.presentError = null;
    await tester.tap(find.byKey(const Key('agreement-retry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsOneWidget);
    expect(fake.acceptCalls, 0);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value, isFalse);

    fake.acceptError = const NetworkException('accept failed');
    await tester.tap(find.byKey(const Key('agreement-consent')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agreement-confirm')));
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, 1);
    fake.acceptError = null;
    await tester.tap(find.byKey(const Key('agreement-retry')));
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, 2);
    expect(fake.acceptKeys[1], fake.acceptKeys[0]);
    expect(fake.acceptPresentations[1], fake.acceptPresentations[0]);
  });

  testWidgets('a field edit clears consent and a later retry does not accept the new document', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeAgreement()..acceptError = const NetworkException('accept failed');
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await _fillDeclaredFields(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agreement-consent')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agreement-confirm')));
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, 1);

    fake.holdPresents = true;
    await tester.enterText(find.byKey(const Key('agreement-full-name')), 'نام دیگر');
    await tester.pump();
    expect(find.byKey(const Key('agreement-rendered')), findsNothing);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value, isFalse);
    expect(tester.widget<AppButton>(find.byKey(const Key('agreement-confirm'))).onPressed, isNull);
    final acceptsAfterEdit = fake.acceptCalls;
    await tester.tap(find.byKey(const Key('agreement-retry')));
    await tester.pump();
    expect(fake.acceptCalls, acceptsAfterEdit);
    for (final hold in List<Completer<void>>.from(fake.presentHolds)) {
      if (!hold.isCompleted) hold.complete();
    }
    fake.holdPresents = false;
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, acceptsAfterEdit);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value, isFalse);
    expect(tester.widget<AppButton>(find.byKey(const Key('agreement-confirm'))).onPressed, isNull);

    fake.acceptError = null;
    await tester.tap(find.byKey(const Key('agreement-consent')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agreement-confirm')));
    await tester.pumpAndSettle();
    expect(fake.acceptCalls, acceptsAfterEdit + 1);
    expect(fake.acceptKeys.last, isNot(fake.acceptKeys.first));
    expect(fake.acceptPresentations.last, isNot(fake.acceptPresentations.first));
    expect(fake.acceptPresentations.last, contains('presentation-'));
  });

  testWidgets('a late preview cannot restore consent after an incomplete edit or a different phone', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await _fillDeclaredFields(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agreement-consent')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsOneWidget);

    fake.holdPresents = true;
    await tester.enterText(find.byKey(const Key('agreement-salon-name')), 'سالن دیگر');
    await tester.pump();
    expect(fake.presentHolds, isNotEmpty);
    await tester.enterText(find.byKey(const Key('agreement-salon-name')), '');
    await tester.pump();
    fake.presentHolds.first.complete();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsNothing);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value, isFalse);
    expect(tester.widget<AppButton>(find.byKey(const Key('agreement-confirm'))).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('agreement-salon-name')), 'سالن نرگس');
    await tester.pump();
    expect(fake.presentHolds.length, greaterThan(1));
    await tester.enterText(find.byKey(const Key('agreement-phone')), '09121111111');
    await tester.pump();
    fake.presentHolds[1].complete();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-phone-unverified')), findsOneWidget);
    expect(find.byKey(const Key('agreement-rendered')), findsNothing);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value, isFalse);
    expect(tester.widget<AppButton>(find.byKey(const Key('agreement-confirm'))).onPressed, isNull);
    expect(fake.acceptCalls, 0);
  });

  testWidgets('recorded state has no payment instruction', (tester) async {
    final fake = _FakeAgreement();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          agreementRepositoryProvider.overrideWithValue(fake),
          authControllerProvider.overrideWith(_SignedInAuth.new),
        ],
        child: const MaterialApp(home: AgreementRecordedScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(agreementRecordedText), findsOneWidget);
    expect(find.text('CONTRACT_V1'), findsOneWidget);
    expect(find.textContaining('کارت'), findsNothing);
    expect(find.textContaining('شبا'), findsNothing);
    expect(find.textContaining('واریز به'), findsNothing);
  });
}

Future<void> _fillDeclaredFields(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('agreement-full-name')), 'نرگس رضایی');
  await tester.enterText(find.byKey(const Key('agreement-national-id')), '0013542419');
  await tester.enterText(find.byKey(const Key('agreement-salon-name')), 'سالن نرگس');
}

Widget _app(_FakeAgreement fake) {
  return ProviderScope(
    overrides: [
      agreementRepositoryProvider.overrideWithValue(fake),
      authControllerProvider.overrideWith(_SignedInAuth.new),
    ],
    child: const MaterialApp(home: AgreementScreen()),
  );
}
