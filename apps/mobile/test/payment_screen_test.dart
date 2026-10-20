import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/widgets/app_widgets.dart';
import 'package:salon_mobile/features/activation/activation_repository.dart';
import 'package:salon_mobile/shared/models/models.dart';
import 'package:salon_mobile/features/activation/payment_screen.dart';
import 'package:salon_mobile/features/agreement/agreement_repository.dart';
import 'package:salon_mobile/features/agreement/agreement_screen.dart';

const _card = '5859471121191492';
const _holder = 'امیر محمد پناهی';
const _amount = '۵۰٬۰۰۰٬۰۰۰ ریال';

PaymentInstructions _instructions() {
  return const PaymentInstructions(
    cardNumber: _card,
    cardNumberCopy: _card,
    cardholderName: _holder,
    amountLabel: _amount,
    amountCopy: _amount,
    amountIrr: '50000000.00',
    notice: 'ثبت تصویر فیش به‌تنهایی به معنی تأیید واریز نیست. مدیر پلتفرم واریز بانکی را بررسی می‌کند.',
  );
}

class _FakeActivation extends ActivationRepository {
  _FakeActivation(this.current)
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  ActivationStatus current;
  Object? uploadError;
  int uploads = 0;
  int submits = 0;
  final keys = <String>[];
  final progress = <int>[];
  Completer<void>? holdSubmit;

  @override
  Future<ActivationStatus> status() async => current;

  @override
  Future<StoredReceipt> upload({
    required List<int> bytes,
    required String filename,
    required void Function(int sent, int total) onProgress,
  }) async {
    uploads += 1;
    onProgress(1, 4);
    progress.add(1);
    onProgress(4, 4);
    progress.add(4);
    if (uploadError != null) {
      throw uploadError!;
    }
    current = ActivationStatus(
      phase: 'AWAITING_RECEIPT',
      receiptReady: true,
      receiptId: 'receipt-1',
      rejectionReason: current.rejectionReason,
      instructions: current.instructions,
    );
    return const StoredReceipt(receiptId: 'receipt-1', phase: 'STORED');
  }

  @override
  Future<void> submit({required String receiptId, required String idempotencyKey}) async {
    submits += 1;
    keys.add(idempotencyKey);
    final hold = holdSubmit;
    if (hold != null) {
      await hold.future;
    }
    current = const ActivationStatus(phase: 'UNDER_REVIEW', receiptReady: false);
  }
}

int _exchanges = 0;

class _ExchangeAuth extends AuthController {
  @override
  AuthState build() {
    return AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(
        id: 'user-1',
        tenantId: 'salon-1',
        role: 'OWNER',
        accessState: 'AWAITING_PAYMENT',
        sessionScope: 'onboarding',
      ),
    );
  }

  @override
  Future<void> adoptProductSession() async {
    _exchanges += 1;
    state = AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(
        id: 'user-1',
        tenantId: 'salon-1',
        role: 'OWNER',
        accessState: 'PRODUCT',
        sessionScope: 'product',
      ),
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('copies the server card number and amount and keeps submit disabled', (tester) async {
    final copied = <String>[];
    final fake = _FakeActivation(
      ActivationStatus(phase: 'AWAITING_RECEIPT', receiptReady: false, instructions: _instructions()),
    );
    await _pump(tester, fake, copyText: (value) async => copied.add(value));
    expect(find.text(_card), findsOneWidget);
    expect(find.text(_holder), findsOneWidget);
    expect(find.text(_amount), findsOneWidget);
    expect(find.text(paymentUploadLabel), findsOneWidget);
    expect(tester.widget<AppButton>(find.byKey(const Key('receipt-submit'))).onPressed, isNull);

    await tester.tap(find.byKey(const Key('copy-card-number')));
    await tester.tap(find.byKey(const Key('copy-amount')));
    await tester.pump();
    expect(copied, [_card, _amount]);
  });

  testWidgets('retries a failed upload and submits the stored receipt once', (tester) async {
    final fake = _FakeActivation(
      ActivationStatus(phase: 'AWAITING_RECEIPT', receiptReady: false, instructions: _instructions()),
    );
    fake.uploadError = const NetworkException();
    final bytes = Uint8List.fromList(
      base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
    );
    await _pump(
      tester,
      fake,
      pickImage: () async => (bytes: bytes, name: 'receipt.jpg'),
    );
    await tester.tap(find.byKey(const Key('receipt-picker')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('receipt-preview')), findsOneWidget);
    expect(fake.progress, isNotEmpty);
    expect(find.byKey(const Key('receipt-upload-progress')), findsNothing);
    expect(find.byKey(const Key('payment-error')), findsOneWidget);
    expect(tester.widget<AppButton>(find.byKey(const Key('receipt-submit'))).onPressed, isNull);

    fake.uploadError = null;
    await tester.tap(find.byKey(const Key('payment-retry')));
    await tester.pump();
    await tester.pump();
    expect(fake.uploads, 2);
    expect(tester.widget<AppButton>(find.byKey(const Key('receipt-submit'))).onPressed, isNotNull);

    fake.holdSubmit = Completer<void>();
    await tester.tap(find.byKey(const Key('receipt-submit')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('receipt-submit')));
    await tester.pump();
    expect(fake.submits, 1);
    fake.holdSubmit!.complete();
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('payment-waiting')), findsOneWidget);
    expect(find.text(paymentWaitingText), findsOneWidget);
    expect(fake.keys, hasLength(1));
  });

  testWidgets('restores the waiting screen and exchanges a product session after approval', (tester) async {
    _exchanges = 0;
    final fake = _FakeActivation(const ActivationStatus(phase: 'UNDER_REVIEW', receiptReady: false));
    await _pump(tester, fake, exchange: true, pollInterval: const Duration(milliseconds: 20));
    expect(find.byKey(const Key('payment-waiting')), findsOneWidget);
    expect(find.text(_card), findsNothing);

    fake.current = const ActivationStatus(phase: 'APPROVED', receiptReady: false);
    await tester.pump(const Duration(milliseconds: 40));
    await tester.pump();
    await tester.pump();
    expect(_exchanges, 1);
  });

  testWidgets('shows a rejection reason and allows another upload', (tester) async {
    final fake = _FakeActivation(
      ActivationStatus(
        phase: 'AWAITING_RECEIPT',
        receiptReady: false,
        rejectionReason: 'مبلغ فیش با قرارداد یکی نیست',
        instructions: _instructions(),
      ),
    );
    await _pump(tester, fake);
    expect(find.text('مبلغ فیش با قرارداد یکی نیست'), findsOneWidget);
    expect(find.text(paymentUploadLabel), findsOneWidget);
    expect(tester.widget<AppButton>(find.byKey(const Key('receipt-submit'))).onPressed, isNull);
  });

  testWidgets('shows payment unavailable without card details when no receipt exists', (tester) async {
    final fake = _FakeActivation(
      const ActivationStatus(phase: 'PAYMENT_UNAVAILABLE', receiptReady: false),
    );
    await _pump(tester, fake);
    expect(find.byKey(const Key('payment-unavailable')), findsOneWidget);
    expect(find.text(paymentUnavailableText), findsOneWidget);
    expect(find.text(_card), findsNothing);
    expect(find.text(_holder), findsNothing);
    expect(find.text(_amount), findsNothing);
    expect(find.byKey(const Key('receipt-picker')), findsNothing);
    expect(find.byKey(const Key('receipt-submit')), findsNothing);
    expect(find.byKey(const Key('payment-unavailable-logout')), findsOneWidget);
  });

  testWidgets('keeps a submitted receipt visible without offering a new transfer', (tester) async {
    final fake = _FakeActivation(
      const ActivationStatus(phase: 'UNDER_REVIEW', receiptReady: false),
    );
    await _pump(tester, fake);
    expect(find.byKey(const Key('payment-waiting')), findsOneWidget);
    expect(find.text(_card), findsNothing);
    expect(find.byKey(const Key('receipt-picker')), findsNothing);
    expect(find.byKey(const Key('payment-waiting-logout')), findsOneWidget);
  });

  testWidgets('waiting logout clears the local session and leaves server review untouched', (tester) async {
    _LogoutAuth.logouts = 0;
    final fake = _FakeActivation(
      const ActivationStatus(phase: 'UNDER_REVIEW', receiptReady: false),
    );
    await _pump(tester, fake, logoutAuth: true);
    expect(find.byKey(const Key('payment-waiting')), findsOneWidget);
    expect(find.byKey(const Key('payment-waiting-logout')), findsOneWidget);
    await tester.tap(find.byKey(const Key('payment-waiting-logout')));
    await tester.pump();
    expect(_LogoutAuth.logouts, 1);
    expect(fake.current.phase, 'UNDER_REVIEW');
  });

  testWidgets('payment-unavailable logout clears the local session', (tester) async {
    _LogoutAuth.logouts = 0;
    final fake = _FakeActivation(
      const ActivationStatus(phase: 'PAYMENT_UNAVAILABLE', receiptReady: false),
    );
    await _pump(tester, fake, logoutAuth: true);
    await tester.tap(find.byKey(const Key('payment-unavailable-logout')));
    await tester.pump();
    expect(_LogoutAuth.logouts, 1);
    expect(fake.current.phase, 'PAYMENT_UNAVAILABLE');
  });

  testWidgets('keeps bank details hidden when transfer review is unpublished', (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          activationRepositoryProvider.overrideWithValue(_HiddenActivation()),
          agreementRepositoryProvider.overrideWithValue(_QuietAgreement()),
        ],
        child: const MaterialApp(home: PaymentScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text(agreementRecordedText), findsOneWidget);
    expect(find.text(_card), findsNothing);
    expect(find.text(_amount), findsNothing);
  });
}

class _HiddenActivation extends ActivationRepository {
  _HiddenActivation()
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  @override
  Future<ActivationStatus> status() async {
    throw const ApiException(statusCode: 404, code: 'NOT_FOUND', message: 'Not found');
  }
}

class _QuietAgreement extends AgreementRepository {
  _QuietAgreement()
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  @override
  Future<AgreementReceipt> receipt() async {
    return const AgreementReceipt(
      versionKey: 'CONTRACT_V1',
      acceptedAt: '2026-10-15T12:00:00.000Z',
      renderedDigest: 'digest',
      statement: 'Agreement recorded. Payment instructions are not available.',
    );
  }
}

class _LogoutAuth extends AuthController {
  static int logouts = 0;

  @override
  AuthState build() {
    return AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(
        id: 'user-1',
        tenantId: 'salon-1',
        role: 'OWNER',
        accessState: 'AWAITING_PAYMENT',
        sessionScope: 'onboarding',
      ),
    );
  }

  @override
  Future<void> logout() async {
    logouts += 1;
    state = const AuthState(status: AuthStatus.signedOut);
  }
}

Future<void> _pump(
  WidgetTester tester,
  ActivationRepository repository, {
  bool exchange = false,
  bool logoutAuth = false,
  CopyText? copyText,
  ReceiptImagePicker? pickImage,
  Duration pollInterval = const Duration(days: 1),
}) async {
  tester.view.physicalSize = const Size(800, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        activationRepositoryProvider.overrideWithValue(repository),
        if (exchange) authControllerProvider.overrideWith(_ExchangeAuth.new),
        if (logoutAuth) authControllerProvider.overrideWith(_LogoutAuth.new),
      ],
      child: MaterialApp(
        home: PaymentScreen(
          copyText: copyText,
          pickImage: pickImage,
          pollInterval: pollInterval,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}
