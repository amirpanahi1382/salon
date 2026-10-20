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

const _markdownCheckbox =
    'اینجانب با مشخصات ثبت‌شده در مادهٔ ۱، متن کامل این نسخه از قرارداد خدمات تبلیغاتی اپلیکیشن «جذب مشتری» را مطالعه کرده‌ام و مفاد آن را می‌پذیرم. می‌دانم مبلغ ۵ میلیون تومان بابت کمپینِ دارای تعهد ۵۰۰ ارسال قابل‌احتساب طبق مادهٔ ۴ است، نه تضمین مشاهدهٔ پیام، جذب مشتری، مراجعهٔ حضوری یا فروش. تعهد دارم تخفیف ثبت‌شده در سفارش را مطابق شرایط آن اعمال کنم.';

class _MarkdownAgreement extends _FakeAgreement {
  static String get _uiBlock =>
      '\n\n## متن گزینهٔ تأیید در اپلیکیشن\n\n☐ $_markdownCheckbox\n\n**[$_button]**';

  @override
  Future<AgreementContract> current() async {
    loads += 1;
    return AgreementContract(
      versionKey: 'CONTRACT_V1',
      templateDigest: 'digest',
      amountIrr: '50000000.00',
      amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان',
      checkboxWording: _markdownCheckbox,
      buttonWording: _button,
      verifiedPhone: '09120000000',
      segments: [
        const AgreementSegment.text(
          '# قرارداد ارائهٔ خدمات تبلیغاتی اپلیکیشن «جذب مشتری»\n\n'
          '## مادهٔ ۱ ـ طرفین قرارداد\n\n'
          'این قرارداد میان طرفین زیر منعقد می‌شود:\n\n'
          '**طرف اول ـ ارائه‌دهندهٔ خدمات:** صاحب و مالک برنامهٔ «جذب مشتری».\n\n'
          '**طرف دوم ـ سفارش‌دهنده و نمایندهٔ سالن آرایشگاهی:**  \n'
          'نام و نام خانوادگی: ',
        ),
        const AgreementSegment.field('fullName'),
        const AgreementSegment.text('  \nکد ملی: '),
        const AgreementSegment.field('nationalId'),
        const AgreementSegment.text('  \nنام سالن آرایشگاهی: '),
        const AgreementSegment.field('salonName'),
        const AgreementSegment.text('  \nشمارهٔ تماس: '),
        const AgreementSegment.field('phone'),
        AgreementSegment.text(
          '\n\nطرف دوم اعلام می‌کند مالک سالن یا نمایندهٔ دارای اختیار برای انعقاد این قرارداد است.\n\n'
          '## مادهٔ ۳ ـ مبلغ\n\nمبلغ این قرارداد **۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان** است.\n\n'
          '## مادهٔ ۷ ـ پذیرش\n\nصرف ثبت‌نام پذیرش نیست.$_uiBlock',
        ),
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
    final canonical =
        '# قرارداد ارائهٔ خدمات تبلیغاتی اپلیکیشن «جذب مشتری»\n\n## مادهٔ ۱\n\n$fullName\n$nationalId\n$salonName\n$phone\n\n## مادهٔ ۳\n\nمبلغ این قرارداد **۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان** است.\n\n## مادهٔ ۷\n\nصرف ثبت‌نام پذیرش نیست.$_uiBlock';
    return AgreementPreview(
      presentationId: 'presentation-$presentCalls',
      versionKey: 'CONTRACT_V1',
      renderedDigest: 'rendered',
      amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان',
      buttonWording: _button,
      canonicalDocument: canonical,
    );
  }
}

class _LongAgreement extends _MarkdownAgreement {
  @override
  Future<AgreementContract> current() async {
    final base = await super.current();
    return AgreementContract(
      versionKey: base.versionKey,
      templateDigest: base.templateDigest,
      amountIrr: base.amountIrr,
      amountLabel: base.amountLabel,
      checkboxWording: base.checkboxWording,
      buttonWording: base.buttonWording,
      verifiedPhone: base.verifiedPhone,
      segments: [
        ...base.segments,
        for (var index = 0; index < 24; index += 1)
          const AgreementSegment.text(
            '\n\n## مادهٔ تکمیلی\n\n'
            'این بند برای آزمون قرارداد طولانی تکرار شده است و هیچ اثر دیگری ندارد.',
          ),
      ],
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

    expect(find.byKey(const Key('agreement-title')), findsOneWidget);
    expect(find.text('نسخه CONTRACT_V1'), findsNothing);
    expect(find.byKey(const Key('agreement-amount')), findsNothing);
    expect(find.byKey(const Key('agreement-amount-irr')), findsNothing);
    expect(find.textContaining(_readonly), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(4));
    expect(find.widgetWithText(TextField, _readonly), findsNothing);
    expect(find.byKey(const Key('agreement-jump-to-consent')), findsOneWidget);
    final phoneField = tester.widget<TextField>(
      find.descendant(
        of: find.byKey(const Key('agreement-phone')),
        matching: find.byType(TextField),
      ),
    );
    expect(phoneField.readOnly, isTrue);
    expect(phoneField.controller?.text, '09120000000');
    final fullNameField = tester.widget<TextField>(
      find.descendant(
        of: find.byKey(const Key('agreement-full-name')),
        matching: find.byType(TextField),
      ),
    );
    expect(fullNameField.decoration?.hintText, 'نام و نام خانوادگی');
    expect(fullNameField.decoration?.labelText, isNull);
    expect(fullNameField.decoration?.errorStyle?.color, isNotNull);
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
    // Verified phone stays locked; enterText must not change it.
    await tester.enterText(find.byKey(const Key('agreement-phone')), '09121111111');
    await tester.pumpAndSettle();
    expect(phoneField.controller?.text, '09120000000');
    expect(find.byKey(const Key('agreement-phone-unverified')), findsNothing);

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

  testWidgets('renders contract markdown without raw markers and keeps four fields', (tester) async {
    tester.view.physicalSize = const Size(800, 3200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _MarkdownAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsNWidgets(4));
    expect(find.byKey(const Key('agreement-title')), findsOneWidget);
    final title = tester.widget<Text>(find.byKey(const Key('agreement-title')));
    expect(title.data, 'قرارداد ارائهٔ خدمات تبلیغاتی اپلیکیشن «جذب مشتری»');
    expect(title.style?.color, agreementTitleGreen);
    expect(find.text('نسخه CONTRACT_V1'), findsNothing);
    expect(find.byKey(const Key('agreement-amount')), findsNothing);
    expect(find.byKey(const Key('agreement-jump-to-consent')), findsOneWidget);
    expect(find.text('کد ملی:'), findsNothing);
    expect(find.text('نام و نام خانوادگی:'), findsNothing);
    expect(find.text('نام سالن آرایشگاهی:'), findsNothing);
    expect(find.bySemanticsLabel('نام و نام خانوادگی'), findsWidgets);
    expect(find.bySemanticsLabel('کد ملی'), findsWidgets);
    expect(find.bySemanticsLabel('نام سالن آرایشگاهی'), findsWidgets);
    expect(find.textContaining('مادهٔ ۱'), findsWidgets);
    expect(find.textContaining('مادهٔ ۳'), findsWidgets);
    expect(find.textContaining('مادهٔ ۷'), findsWidgets);
    expect(find.textContaining('۵۰٬۰۰۰٬۰۰۰ ریال'), findsWidgets);
    expect(find.textContaining('صرف ثبت‌نام پذیرش نیست'), findsWidgets);
    expect(find.textContaining('متن گزینهٔ تأیید در اپلیکیشن'), findsNothing);
    expect(find.textContaining('#'), findsNothing);
    expect(find.textContaining('**'), findsNothing);
    expect(find.text(_markdownCheckbox), findsOneWidget);
    expect(find.text(_button), findsOneWidget);

    final consent = tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent')));
    expect(consent.value, isFalse);

    await tester.enterText(find.byKey(const Key('agreement-full-name')), 'نرگس رضایی');
    await tester.enterText(find.byKey(const Key('agreement-national-id')), '0013542419');
    await tester.enterText(find.byKey(const Key('agreement-salon-name')), 'سالن نرگس');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsOneWidget);
    expect(find.textContaining('متن گزینهٔ تأیید در اپلیکیشن'), findsNothing);
    expect(find.text(_markdownCheckbox), findsOneWidget);
    expect(find.text(_button), findsOneWidget);
    expect(find.textContaining('۵۰٬۰۰۰٬۰۰۰ ریال'), findsWidgets);
    expect(fake.presentCalls, greaterThan(0));
    expect(fake.acceptCalls, 0);

    // At the top of the contract, the jump control is a full-width green bottom bar.
    final jumpAtTop = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    final titleRect = tester.getRect(find.byKey(const Key('agreement-title')));
    final screen = tester.getRect(find.byType(MaterialApp));
    expect(jumpAtTop.width, closeTo(screen.width, 1));
    expect(jumpAtTop.height, agreementJumpBarHeight);
    expect(jumpAtTop.top, greaterThan(titleRect.bottom));
    expect(jumpAtTop.bottom, closeTo(screen.bottom, 1));
    expect(agreementJumpGreen, agreementTitleGreen);
    final jumpMaterial = tester.widget<Material>(
      find
          .ancestor(
            of: find.byKey(const Key('agreement-jump-to-consent')),
            matching: find.byWidgetPredicate(
              (widget) => widget is Material && widget.color == agreementJumpGreen,
            ),
          )
          .first,
    );
    expect(jumpMaterial.color, agreementJumpGreen);

    await tester.tap(find.byKey(const Key('agreement-jump-to-consent')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-consent')), findsOneWidget);
    expect(find.byKey(const Key('agreement-confirm')), findsOneWidget);

    // After jumping, the bar stays at the bottom and does not cover consent/confirm.
    final jumpAfter = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    final consentRect = tester.getRect(find.byKey(const Key('agreement-consent')));
    final confirmRect = tester.getRect(find.byKey(const Key('agreement-confirm')));
    expect(jumpAfter.top, closeTo(jumpAtTop.top, 0.5));
    expect(consentRect.bottom <= jumpAfter.top + 1, isTrue);
    expect(confirmRect.bottom <= jumpAfter.top + 1, isTrue);
    expect(
      tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value,
      isFalse,
    );

    await tester.enterText(find.byKey(const Key('agreement-full-name')), 'Narges');
    await tester.pumpAndSettle();
    expect(find.text('نام را با حروف فارسی وارد کنید.'), findsOneWidget);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).onChanged, isNull);
    expect(find.byKey(const Key('agreement-rendered')), findsNothing);
  });

  testWidgets('one tap reveals consent and confirm on a long contract with the keyboard open',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1000);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetViewInsets();
    });
    final fake = _LongAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await _fillDeclaredFields(tester);
    await tester.pumpAndSettle();

    final barBefore = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    final consentBefore = tester.getRect(find.byKey(const Key('agreement-consent')));
    expect(consentBefore.top, greaterThan(barBefore.top));

    await tester.tap(find.byKey(const Key('agreement-jump-to-consent')));
    tester.view.viewInsets = const FakeViewPadding();
    await tester.pumpAndSettle();

    final scrollRect = tester.getRect(find.byKey(const Key('agreement-scroll')));
    final bar = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    final consent = tester.getRect(find.byKey(const Key('agreement-consent')));
    final confirm = tester.getRect(find.byKey(const Key('agreement-confirm')));
    expect(bar.top, closeTo(scrollRect.bottom, 0.5));
    expect(consent.top, greaterThanOrEqualTo(scrollRect.top - 1));
    expect(consent.bottom, lessThanOrEqualTo(bar.top + 1));
    expect(confirm.top, greaterThanOrEqualTo(consent.bottom));
    expect(confirm.bottom, lessThanOrEqualTo(bar.top + 1));
    expect(
      tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).value,
      isFalse,
    );
    expect(fake.acceptCalls, 0);
  });

  testWidgets('keeps the bottom jump bar above the keyboard inset', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetViewInsets();
    });
    final fake = _MarkdownAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    final jump = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    final title = tester.getRect(find.byKey(const Key('agreement-title')));
    final screen = tester.getRect(find.byType(MaterialApp));
    expect(jump.width, closeTo(screen.width, 1));
    expect(jump.height, agreementJumpBarHeight);
    expect(jump.top, greaterThan(title.bottom));
    // Scaffold resizes above the keyboard; the bar sits at the bottom of that area.
    expect(jump.bottom, closeTo(screen.bottom - 280, 1));
  });

  testWidgets('keeps the bottom jump bar fixed after scrolling the contract body', (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _MarkdownAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    final jumpBefore = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    final screen = tester.getRect(find.byType(MaterialApp));
    expect(jumpBefore.width, closeTo(screen.width, 1));
    expect(jumpBefore.height, agreementJumpBarHeight);
    expect(jumpBefore.bottom, closeTo(screen.bottom, 1));

    await tester.drag(find.byKey(const Key('agreement-scroll')), const Offset(0, -600));
    await tester.pumpAndSettle();

    final jumpAfter = tester.getRect(find.byKey(const Key('agreement-jump-to-consent')));
    expect(jumpAfter.top, closeTo(jumpBefore.top, 0.5));
    expect(jumpAfter.bottom, closeTo(jumpBefore.bottom, 0.5));
    expect(jumpAfter.width, closeTo(screen.width, 1));
    expect(find.byKey(const Key('agreement-jump-to-consent')), findsOneWidget);
  });

  testWidgets('blocks consent while declared fields are invalid', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final fake = _FakeAgreement();
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('agreement-full-name')), 'نرگس رضایی');
    await tester.enterText(find.byKey(const Key('agreement-national-id')), '0013542410');
    await tester.enterText(find.byKey(const Key('agreement-salon-name')), 'سالن Glow');
    await tester.pumpAndSettle();

    expect(find.text('کد ملی معتبر نیست.'), findsOneWidget);
    expect(find.byKey(const Key('agreement-rendered')), findsNothing);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).onChanged, isNull);
    expect(fake.presentCalls, 0);

    await tester.enterText(find.byKey(const Key('agreement-national-id')), '0013542419');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('agreement-rendered')), findsOneWidget);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('agreement-consent'))).onChanged, isNotNull);
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
    expect(find.byKey(const Key('agreement-title')), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(4));
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

  testWidgets('a late preview cannot restore consent after an incomplete edit', (tester) async {
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
    await tester.enterText(find.byKey(const Key('agreement-full-name')), '');
    await tester.pump();
    fake.presentHolds[1].complete();
    await tester.pumpAndSettle();
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
