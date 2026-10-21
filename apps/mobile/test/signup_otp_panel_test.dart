import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/features/auth/signup_otp_panel.dart';
import 'package:salon_mobile/shared/labels.dart';

class _Clock {
  _Clock([DateTime? start]) : current = start ?? DateTime(2026, 10, 20, 12);

  DateTime current;

  DateTime now() => current;

  void advance(Duration duration) {
    current = current.add(duration);
  }
}

class _Call {
  const _Call(this.phone, this.key, [this.code = '']);

  final String phone;
  final String key;
  final String code;
}

class _OtpRepository extends AuthRepository {
  _OtpRepository()
    : super(
        api: ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
        sessionStore: MemorySessionStore(),
      );

  final starts = <_Call>[];
  final verifies = <_Call>[];
  Object? startError;
  Object? verifyError;
  Duration startDelay = Duration.zero;
  Duration verifyDelay = Duration.zero;
  _Clock? clock;
  PhoneSignupChallenge challenge = const PhoneSignupChallenge(
    expiresInSeconds: 60,
    resendAvailableInSeconds: 60,
  );

  @override
  Future<PhoneSignupChallenge> startPhoneSignup({
    required String phone,
    required String idempotencyKey,
  }) async {
    starts.add(_Call(phone, idempotencyKey));
    if (startDelay > Duration.zero) {
      clock?.advance(startDelay);
      await Future<void>.delayed(Duration.zero);
    }
    if (startError != null) {
      throw startError!;
    }
    return challenge;
  }

  @override
  Future<String> verifyPhoneSignup({
    required String phone,
    required String otpCode,
    required String idempotencyKey,
  }) async {
    verifies.add(_Call(phone, idempotencyKey, otpCode));
    if (verifyDelay > Duration.zero) {
      clock?.advance(verifyDelay);
      await Future<void>.delayed(Duration.zero);
    }
    if (verifyError != null) {
      throw verifyError!;
    }
    return 'proof-$otpCode';
  }
}

Future<void> _pump(
  WidgetTester tester,
  _OtpRepository repository,
  _Clock clock, {
  Duration expiresIn = const Duration(seconds: 60),
  Duration resendIn = const Duration(seconds: 60),
  ValueChanged<String>? onVerified,
  Size size = const Size(400, 900),
}) async {
  // Phone-tall surface so the full-width verify button stays hittable.
  await tester.binding.setSurfaceSize(size);
  addTearDown(() async {
    await tester.binding.setSurfaceSize(null);
  });
  final expiresAt = clock.now().add(expiresIn);
  final resendAt = clock.now().add(resendIn);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.app(),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: SignupOtpPanel(
            phone: '09120000000',
            expiresAt: expiresAt,
            resendAvailableAt: resendAt,
            repository: repository,
            now: clock.now,
            onVerified: onVerified ?? (_) {},
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
  });
}

bool _canPress(WidgetTester tester, Key key) {
  final button = tester.widget<FilledButton>(find.byKey(key));
  return button.onPressed != null;
}

bool? _resendEnabled(WidgetTester tester) {
  final button = tester.widget<TextButton>(
    find.byKey(const Key('signup-resend')),
  );
  return button.onPressed != null;
}

Future<void> _tapKey(WidgetTester tester, Key key) async {
  final finder = find.byKey(key);
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}

Future<void> _expire(WidgetTester tester, _Clock clock) async {
  clock.advance(const Duration(seconds: 60));
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  test('visible OTP slots show four, then one per digit up to eight', () {
    expect(signupOtpVisibleSlotCount(0), 4);
    expect(signupOtpVisibleSlotCount(3), 4);
    expect(signupOtpVisibleSlotCount(4), 4);
    expect(signupOtpVisibleSlotCount(5), 5);
    expect(signupOtpVisibleSlotCount(6), 6);
    expect(signupOtpVisibleSlotCount(7), 7);
    expect(signupOtpVisibleSlotCount(8), 8);
    expect(signupOtpVisibleSlotCount(9), 8);
  });

  testWidgets('shows heading, masked phone, code field and countdown', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    expect(find.byKey(const Key('signup-otp-heading')), findsOneWidget);
    expect(find.text(AppStrings.signupOtpHeading), findsOneWidget);
    expect(
      find.text(AppStrings.signupOtpDestination('۰۹۱۲****۰۰۰')),
      findsOneWidget,
    );
    expect(find.textContaining('۴ تا ۸'), findsNothing);
    expect(find.byKey(const Key('signup-otp-error')), findsNothing);
    expect(find.byKey(const Key('signup-code')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('signup-code-countdown'))).data,
      contains('۰۱:۰۰'),
    );
    expect(_resendEnabled(tester), isFalse);
    expect(find.textContaining('ارسال مجدد'), findsOneWidget);
    expect(_canPress(tester, const Key('signup-verify')), isFalse);
    expect(find.text(AppStrings.verifySignupCode), findsOneWidget);
  });

  testWidgets('verify stays disabled for empty and 1-3 digit codes', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    expect(_canPress(tester, const Key('signup-verify')), isFalse);
    for (final code in ['1', '12', '123']) {
      await tester.enterText(find.byKey(const Key('signup-code')), code);
      await tester.pump();
      expect(
        _canPress(tester, const Key('signup-verify')),
        isFalse,
        reason: code,
      );
    }

    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();
    expect(repository.verifies, isEmpty);
  });

  testWidgets('verify enables for every valid 4-8 digit code', (tester) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    for (final code in ['1234', '12345', '123456', '1234567', '12345678']) {
      await tester.enterText(find.byKey(const Key('signup-code')), code);
      await tester.pump();
      expect(
        _canPress(tester, const Key('signup-verify')),
        isTrue,
        reason: code,
      );
    }
  });

  testWidgets('deleting back below four digits disables verify again', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    await tester.enterText(find.byKey(const Key('signup-code')), '1234');
    await tester.pump();
    expect(_canPress(tester, const Key('signup-verify')), isTrue);

    await tester.enterText(find.byKey(const Key('signup-code')), '123');
    await tester.pump();
    expect(_canPress(tester, const Key('signup-verify')), isFalse);

    await tester.enterText(find.byKey(const Key('signup-code')), '');
    await tester.pump();
    expect(_canPress(tester, const Key('signup-verify')), isFalse);
  });

  testWidgets('expiry disables verify even while a valid code is present', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    await tester.enterText(find.byKey(const Key('signup-code')), '123456');
    await tester.pump();
    expect(_canPress(tester, const Key('signup-verify')), isTrue);

    await _expire(tester, clock);
    expect(_canPress(tester, const Key('signup-verify')), isFalse);
    expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
  });

  testWidgets('editing the code clears a stale resend confirmation', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);
    await _expire(tester, clock);

    await _tapKey(tester, const Key('signup-resend'));
    await tester.pump();
    expect(find.byKey(const Key('signup-otp-info')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('signup-code')), '1');
    await tester.pump();
    expect(find.byKey(const Key('signup-otp-info')), findsNothing);
    expect(_canPress(tester, const Key('signup-verify')), isFalse);
  });

  testWidgets('segmented boxes grow one per typed digit up to 8', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    int boxCount() {
      final column = tester.widget<Column>(
        find
            .ancestor(
              of: find.byKey(const Key('signup-code')),
              matching: find.byType(Column),
            )
            .first,
      );
      final row = column.children.whereType<GestureDetector>().first.child;
      expect(row, isA<Directionality>());
      final directionality = row! as Directionality;
      return (directionality.child as Row).children.length;
    }

    expect(boxCount(), 4);
    await tester.enterText(find.byKey(const Key('signup-code')), '12345');
    await tester.pump();
    expect(boxCount(), 5);
    await tester.enterText(find.byKey(const Key('signup-code')), '1234567');
    await tester.pump();
    expect(boxCount(), 7);
    await tester.enterText(find.byKey(const Key('signup-code')), '12345678');
    await tester.pump();
    expect(boxCount(), 8);
  });

  testWidgets('countdown and resend stay on one line on a narrow phone', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock, size: const Size(320, 640));

    expect(tester.takeException(), isNull);
    final validity = tester.getRect(
      find.byKey(const Key('signup-code-countdown')),
    );
    final resend = tester.getRect(find.byKey(const Key('signup-resend')));
    expect(validity.overlaps(resend), isFalse);
    expect(resend.height, lessThan(48));
  });

  testWidgets('assistive tech gets the code value and the 4-8 digit hint', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    try {
      final repository = _OtpRepository();
      final clock = _Clock();
      await _pump(tester, repository, clock);

      await tester.enterText(find.byKey(const Key('signup-code')), '123456');
      await tester.pump();

      final semantics = tester.getSemantics(
        find.byKey(const Key('signup-code-semantics')),
      );
      expect(semantics.label, AppStrings.signupOtpCodeLabel);
      expect(semantics.value, '۱۲۳۴۵۶');
      expect(semantics.hint, '۴ تا ۸ رقم');
      expect(semantics.getSemanticsData().flagsCollection.isTextField, isTrue);
    } finally {
      handle.dispose();
    }
  });

  testWidgets('counts down from the server deadline', (tester) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    clock.advance(const Duration(seconds: 10));
    await tester.pump(const Duration(seconds: 1));
    expect(
      tester.widget<Text>(find.byKey(const Key('signup-code-countdown'))).data,
      contains('۰۰:۵۰'),
    );

    clock.advance(const Duration(seconds: 25));
    await tester.pump(const Duration(seconds: 1));
    expect(
      tester.widget<Text>(find.byKey(const Key('signup-code-countdown'))).data,
      contains('۰۰:۲۵'),
    );
  });

  testWidgets('pause and resume keeps the deadline instead of resetting', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    clock.advance(const Duration(seconds: 30));
    await tester.pump(const Duration(seconds: 30));
    expect(
      tester.widget<Text>(find.byKey(const Key('signup-code-countdown'))).data,
      contains('۰۱:۰۰'),
    );

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(const Key('signup-code-countdown'))).data,
      contains('۰۰:۳۰'),
    );
  });

  testWidgets(
    'expiration disables verification and enables a deliberate resend',
    (tester) async {
      final repository = _OtpRepository();
      final clock = _Clock();
      await _pump(tester, repository, clock);
      await tester.enterText(find.byKey(const Key('signup-code')), '123456');

      await _expire(tester, clock);

      expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('signup-code')))
            .controller
            ?.text,
        isEmpty,
      );
      expect(_canPress(tester, const Key('signup-verify')), isFalse);
      expect(_resendEnabled(tester), isTrue);
      expect(repository.starts, isEmpty);

      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      expect(repository.starts, hasLength(1));
    },
  );

  testWidgets(
    'expiration clears a stale wrong-code error and the obsolete digits',
    (tester) async {
      final repository = _OtpRepository();
      final clock = _Clock();
      await _pump(tester, repository, clock);

      repository.verifyError = const ApiException(
        statusCode: 400,
        code: 'SIGNUP_VERIFICATION_FAILED',
        message: 'bad code',
      );
      await tester.enterText(find.byKey(const Key('signup-code')), '111111');
      await _tapKey(tester, const Key('signup-verify'));
      await tester.pump();
      expect(find.text(AppStrings.signupCodeInvalid), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('signup-code')))
            .controller
            ?.text,
        '111111',
      );

      await _expire(tester, clock);

      expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
      expect(find.text(AppStrings.signupCodeInvalid), findsNothing);
      expect(find.byKey(const Key('signup-otp-error')), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('signup-code')))
            .controller
            ?.text,
        isEmpty,
      );
      expect(_resendEnabled(tester), isTrue);
      expect(_canPress(tester, const Key('signup-verify')), isFalse);
    },
  );

  testWidgets(
    'a late verify failure after expiry does not restore a wrong-code message',
    (tester) async {
      final repository = _OtpRepository();
      final clock = _Clock();
      repository.clock = clock;
      repository.verifyDelay = const Duration(seconds: 5);
      repository.verifyError = const ApiException(
        statusCode: 400,
        code: 'SIGNUP_VERIFICATION_FAILED',
        message: 'bad code',
      );
      await _pump(
        tester,
        repository,
        clock,
        expiresIn: const Duration(seconds: 3),
        resendIn: const Duration(seconds: 3),
      );

      await tester.enterText(find.byKey(const Key('signup-code')), '111111');
      await _tapKey(tester, const Key('signup-verify'));
      await tester.pump();
      // Deadline passes while the verify request is still in flight.
      clock.advance(const Duration(seconds: 3));
      await tester.pump(const Duration(seconds: 1));
      expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      expect(repository.verifies, hasLength(1));
      expect(find.text(AppStrings.signupCodeInvalid), findsNothing);
      expect(find.byKey(const Key('signup-otp-error')), findsNothing);
      expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('signup-code')))
            .controller
            ?.text,
        isEmpty,
      );
      expect(_canPress(tester, const Key('signup-verify')), isFalse);
    },
  );

  testWidgets('a confirmed resend clears the code and uses the new deadlines', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);
    await tester.enterText(find.byKey(const Key('signup-code')), '123456');

    await _expire(tester, clock);
    repository.challenge = const PhoneSignupChallenge(
      expiresInSeconds: 45,
      resendAvailableInSeconds: 30,
    );
    await _tapKey(tester, const Key('signup-resend'));
    await tester.pump();

    expect(repository.starts, hasLength(1));
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('signup-code')))
          .controller
          ?.text,
      isEmpty,
    );
    expect(find.textContaining('۰۰:۴۵'), findsOneWidget);
    expect(find.textContaining('۰۰:۳۰'), findsOneWidget);
    expect(find.byKey(const Key('signup-otp-info')), findsOneWidget);

    clock.advance(const Duration(seconds: 30));
    await tester.pump(const Duration(seconds: 1));
    expect(_resendEnabled(tester), isTrue);
    repository.challenge = const PhoneSignupChallenge(
      expiresInSeconds: 60,
      resendAvailableInSeconds: 60,
    );
    await _tapKey(tester, const Key('signup-resend'));
    await tester.pump();

    expect(repository.starts, hasLength(2));
    expect(repository.starts[1].key, isNot(repository.starts[0].key));
  });

  testWidgets(
    'an ambiguous resend keeps its key and never sends automatically',
    (tester) async {
      final repository = _OtpRepository();
      final clock = _Clock();
      await _pump(tester, repository, clock);
      await _expire(tester, clock);

      repository.startError = const NetworkException();
      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      expect(repository.starts, hasLength(1));
      expect(find.byKey(const Key('signup-otp-error')), findsOneWidget);
      expect(find.textContaining('HTTP'), findsNothing);

      await tester.pump(const Duration(seconds: 5));
      expect(repository.starts, hasLength(1));

      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      expect(repository.starts, hasLength(2));
      expect(repository.starts[1].key, repository.starts[0].key);

      repository.startError = null;
      repository.challenge = const PhoneSignupChallenge(
        expiresInSeconds: 60,
        resendAvailableInSeconds: 60,
      );
      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      expect(repository.starts, hasLength(3));
      expect(repository.starts[2].key, repository.starts[0].key);
      expect(find.byKey(const Key('signup-otp-info')), findsOneWidget);

      clock.advance(const Duration(seconds: 60));
      await tester.pump(const Duration(seconds: 1));
      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      expect(repository.starts, hasLength(4));
      expect(repository.starts[3].key, isNot(repository.starts[0].key));
    },
  );

  testWidgets('a resend cooldown error uses the structured deadline', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);
    await _expire(tester, clock);

    repository.startError = const ApiException(
      statusCode: 429,
      code: 'SIGNUP_RESEND_COOLDOWN',
      message: 'No prose number here.',
      details: {'retryAfterSeconds': 42},
    );
    await _tapKey(tester, const Key('signup-resend'));
    await tester.pump();

    expect(find.text(AppStrings.signupResendWaitSeconds(42)), findsOneWidget);
    expect(_resendEnabled(tester), isFalse);
    expect(find.textContaining('۰۰:۴۲'), findsOneWidget);

    clock.advance(const Duration(seconds: 42));
    await tester.pump(const Duration(seconds: 1));
    expect(_resendEnabled(tester), isTrue);
  });

  testWidgets('verification uses a new key for a corrected code', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    repository.verifyError = const ApiException(
      statusCode: 400,
      code: 'SIGNUP_VERIFICATION_FAILED',
      message: 'The code could not be verified.',
    );
    await tester.enterText(find.byKey(const Key('signup-code')), '111111');
    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-code')), '222222');
    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();

    expect(repository.verifies, hasLength(2));
    expect(repository.verifies[1].key, isNot(repository.verifies[0].key));
    expect(repository.verifies[1].code, '222222');
    expect(find.text(AppStrings.signupCodeInvalid), findsOneWidget);
  });

  testWidgets('an ambiguous verification retries the original code and key', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    String? proof;
    await _pump(
      tester,
      repository,
      clock,
      onVerified: (value) => proof = value,
    );

    repository.verifyError = const ApiException(
      statusCode: 409,
      code: 'SIGNUP_VERIFICATION_UNCONFIRMED',
      message: 'unconfirmed',
    );
    await tester.enterText(find.byKey(const Key('signup-code')), '222222');
    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('signup-code')))
          .controller
          ?.text,
      '222222',
    );
    await tester.enterText(find.byKey(const Key('signup-code')), '333333');
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('signup-code')))
          .controller
          ?.text,
      '222222',
      reason: 'visible input stays on the pending ambiguous code',
    );
    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();

    expect(repository.verifies, hasLength(2));
    expect(repository.verifies[1].key, repository.verifies[0].key);
    expect(repository.verifies[1].code, '222222');
    expect(find.text(AppStrings.signupVerificationUnconfirmed), findsOneWidget);
    expect(proof, isNull);
  });

  testWidgets(
    'network delay shortens code validity and keeps resend on response time',
    (tester) async {
      final repository = _OtpRepository();
      final clock = _Clock();
      repository.clock = clock;
      repository.startDelay = const Duration(seconds: 8);
      repository.challenge = const PhoneSignupChallenge(
        expiresInSeconds: 60,
        resendAvailableInSeconds: 60,
      );
      await _pump(
        tester,
        repository,
        clock,
        expiresIn: const Duration(seconds: 1),
        resendIn: Duration.zero,
      );
      await _expire(tester, clock);
      expect(_resendEnabled(tester), isTrue);

      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      expect(repository.starts, hasLength(1));
      // Request started at T; response arrived at T+8 with 60s remaining → UI
      // deadline is T+60, so only 52s remain after the delayed response.
      expect(find.textContaining('۰۰:۵۲'), findsOneWidget);
      expect(find.textContaining('۰۱:۰۰'), findsOneWidget);
      expect(_resendEnabled(tester), isFalse);
    },
  );

  testWidgets('a superseded challenge expires the code and clears the field', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    repository.verifyError = const ApiException(
      statusCode: 409,
      code: 'SIGNUP_CHALLENGE_SUPERSEDED',
      message: 'replaced',
    );
    await tester.enterText(find.byKey(const Key('signup-code')), '123456');
    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();

    expect(find.text(AppStrings.signupChallengeSuperseded), findsOneWidget);
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('signup-code')))
          .controller
          ?.text,
      isEmpty,
    );
    expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
    expect(_canPress(tester, const Key('signup-verify')), isFalse);
  });

  testWidgets(
    'successful verification returns the proof and normalizes digits',
    (tester) async {
      final repository = _OtpRepository();
      final clock = _Clock();
      String? proof;
      await _pump(
        tester,
        repository,
        clock,
        onVerified: (value) => proof = value,
      );

      await tester.enterText(find.byKey(const Key('signup-code')), '۱۲۳۴۵۶');
      await _tapKey(tester, const Key('signup-verify'));
      await tester.pump();

      expect(repository.verifies, hasLength(1));
      expect(repository.verifies.single.code, '123456');
      expect(proof, 'proof-123456');
    },
  );

  testWidgets('verification attempt limit locks verification until resend', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);

    repository.verifyError = const ApiException(
      statusCode: 429,
      code: 'SIGNUP_VERIFICATION_LIMIT',
      message: 'Too many verification attempts.',
      details: {'retryAfterSeconds': 120},
    );
    await tester.enterText(find.byKey(const Key('signup-code')), '111111');
    await _tapKey(tester, const Key('signup-verify'));
    await tester.pump();

    expect(find.text(AppStrings.signupVerificationLimit), findsOneWidget);
    expect(_canPress(tester, const Key('signup-verify')), isFalse);
    expect(find.textContaining('۰۲:۰۰'), findsOneWidget);

    clock.advance(const Duration(seconds: 120));
    await tester.pump(const Duration(seconds: 1));
    repository.challenge = const PhoneSignupChallenge(
      expiresInSeconds: 60,
      resendAvailableInSeconds: 60,
    );
    repository.verifyError = null;
    await _tapKey(tester, const Key('signup-resend'));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-code')), '123456');
    await tester.pump();

    expect(_canPress(tester, const Key('signup-verify')), isTrue);
  });

  testWidgets('each server error shows a concise Persian next step', (
    tester,
  ) async {
    final cases = <({String code, String expected, bool expiredBanner})>[
      (
        code: 'SIGNUP_CHALLENGE_EXPIRED',
        // Local expiry UI; resend wait is still open so the wait variant shows.
        expected: AppStrings.signupCodeExpiredWait,
        expiredBanner: true,
      ),
      (
        code: 'SIGNUP_CHALLENGE_SUPERSEDED',
        expected: AppStrings.signupChallengeSuperseded,
        expiredBanner: true,
      ),
      (
        code: 'SIGNUP_VERIFICATION_FAILED',
        expected: AppStrings.signupCodeInvalid,
        expiredBanner: false,
      ),
      (
        code: 'INFRASTRUCTURE_ERROR',
        expected: AppStrings.signupServiceUnavailable,
        expiredBanner: false,
      ),
    ];

    for (final item in cases) {
      final repository = _OtpRepository();
      final clock = _Clock();
      await _pump(tester, repository, clock);
      repository.verifyError = ApiException(
        statusCode: item.code == 'INFRASTRUCTURE_ERROR' ? 503 : 409,
        code: item.code,
        message: 'English diagnostic that must stay hidden.',
      );
      await tester.enterText(find.byKey(const Key('signup-code')), '123456');
      await _tapKey(tester, const Key('signup-verify'));
      await tester.pump();

      expect(find.text(item.expected), findsOneWidget, reason: item.code);
      if (item.expiredBanner) {
        expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('signup-code')))
              .controller
              ?.text,
          isEmpty,
          reason: item.code,
        );
      }
      expect(find.textContaining('HTTP'), findsNothing);
      expect(find.textContaining('English diagnostic'), findsNothing);

      await tester.pumpWidget(const SizedBox());
    }
  });

  testWidgets('send limit error shows the structured retry window', (
    tester,
  ) async {
    final repository = _OtpRepository();
    final clock = _Clock();
    await _pump(tester, repository, clock);
    await _expire(tester, clock);

    repository.startError = const ApiException(
      statusCode: 429,
      code: 'SIGNUP_SEND_LIMIT',
      message: 'Another signup message cannot be sent yet.',
      details: {'retryAfterSeconds': 120},
    );
    await _tapKey(tester, const Key('signup-resend'));
    await tester.pump();

    expect(find.text(AppStrings.signupSendLimitSeconds(120)), findsOneWidget);
    expect(_resendEnabled(tester), isFalse);
    expect(find.textContaining('۰۲:۰۰'), findsOneWidget);
  });
}
