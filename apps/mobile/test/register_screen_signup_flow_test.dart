import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/features/auth/auth_screens.dart';
import 'package:salon_mobile/shared/labels.dart';

class _Clock {
  _Clock([DateTime? start]) : current = start ?? DateTime(2026, 10, 21, 9);

  DateTime current;

  DateTime now() => current;

  void advance(Duration duration) {
    current = current.add(duration);
  }
}

class _Call {
  const _Call(this.phone, this.key, [this.extra = '']);

  final String phone;
  final String key;
  final String extra;
}

class _FlowRepository extends AuthRepository {
  _FlowRepository()
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
  PhoneSignupChallenge challenge = const PhoneSignupChallenge(
    expiresInSeconds: 60,
    resendAvailableInSeconds: 60,
  );
  Duration startDelay = Duration.zero;
  _Clock? clock;

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
    if (verifyError != null) {
      throw verifyError!;
    }
    return 'proof-$otpCode';
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FlowRepository repository,
  _Clock clock,
) async {
  await tester.binding.setSurfaceSize(const Size(400, 900));
  addTearDown(() async {
    await tester.binding.setSurfaceSize(null);
  });
  var keySerial = 0;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [authRepositoryProvider.overrideWith((ref) => repository)],
      child: MaterialApp(
        theme: AppTheme.app(),
        home: RegisterScreen(
          now: clock.now,
          keyFactory: () {
            keySerial += 1;
            return 'key-$keySerial';
          },
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _tapKey(WidgetTester tester, Key key) async {
  final finder = find.byKey(key);
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}

void main() {
  testWidgets(
    'RegisterScreen phone → OTP expiry/resend/error → verified proof → account details',
    (tester) async {
      final repository = _FlowRepository();
      final clock = _Clock();
      repository.clock = clock;
      await _pump(tester, repository, clock);

      expect(find.byKey(const Key('signup-phone')), findsOneWidget);
      expect(find.byKey(const Key('signup-submit')), findsOneWidget);
      expect(find.byKey(const Key('signup-code')), findsNothing);

      repository.startDelay = const Duration(seconds: 5);
      repository.challenge = const PhoneSignupChallenge(
        expiresInSeconds: 60,
        resendAvailableInSeconds: 45,
      );
      await tester.enterText(find.byKey(const Key('signup-phone')), '09123334455');
      await _tapKey(tester, const Key('signup-submit'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      expect(repository.starts, hasLength(1));
      expect(find.byKey(const Key('signup-otp-heading')), findsOneWidget);
      expect(find.byKey(const Key('signup-code')), findsOneWidget);
      // Request start anchored validity: 60s from T, response at T+5 → 55s left.
      expect(find.textContaining('۰۰:۵۵'), findsOneWidget);
      expect(find.textContaining('۰۰:۴۵'), findsOneWidget);
      expect(find.byKey(const Key('signup-salon')), findsNothing);

      repository.verifyError = const ApiException(
        statusCode: 400,
        code: 'SIGNUP_VERIFICATION_FAILED',
        message: 'bad code',
      );
      await tester.enterText(find.byKey(const Key('signup-code')), '111111');
      await _tapKey(tester, const Key('signup-verify'));
      await tester.pump();
      expect(find.text(AppStrings.signupCodeInvalid), findsOneWidget);
      expect(find.byKey(const Key('signup-salon')), findsNothing);

      clock.advance(const Duration(seconds: 55));
      await tester.pump(const Duration(seconds: 1));
      expect(find.byKey(const Key('signup-code-expired')), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(const Key('signup-verify'))).onPressed,
        isNull,
      );
      expect(
        tester.widget<TextButton>(find.byKey(const Key('signup-resend'))).onPressed,
        isNotNull,
      );

      repository.startDelay = Duration.zero;
      repository.challenge = const PhoneSignupChallenge(
        expiresInSeconds: 60,
        resendAvailableInSeconds: 60,
      );
      await _tapKey(tester, const Key('signup-resend'));
      await tester.pump();
      expect(repository.starts, hasLength(2));
      expect(repository.starts[1].key, isNot(repository.starts[0].key));
      expect(
        tester.widget<TextField>(find.byKey(const Key('signup-code'))).controller?.text,
        isEmpty,
      );
      expect(find.byKey(const Key('signup-otp-info')), findsOneWidget);
      expect(find.textContaining('۰۱:۰۰'), findsWidgets);

      repository.verifyError = null;
      await tester.enterText(find.byKey(const Key('signup-code')), '222222');
      await _tapKey(tester, const Key('signup-verify'));
      await tester.pump();

      expect(repository.verifies, hasLength(2));
      expect(repository.verifies.last.extra, '222222');
      expect(find.byKey(const Key('signup-code')), findsNothing);
      expect(find.byKey(const Key('signup-salon')), findsOneWidget);
      expect(find.byKey(const Key('signup-owner')), findsOneWidget);
      expect(find.byKey(const Key('signup-password')), findsOneWidget);
      expect(find.byKey(const Key('signup-password-confirmation')), findsOneWidget);
      expect(find.text(AppStrings.createAccount), findsOneWidget);
      expect(find.byKey(const Key('signup-submit')), findsOneWidget);
    },
  );
}
