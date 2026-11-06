import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/features/auth/password_recovery_screen.dart';
import 'package:salon_mobile/shared/labels.dart';

class _Clock {
  _Clock([DateTime? start]) : current = start ?? DateTime(2026, 11, 6, 9);

  DateTime current;

  DateTime now() => current;
}

class _RecoveryRepository extends AuthRepository {
  _RecoveryRepository()
      : super(
          api: ApiClient(
            baseUrl: 'http://example.test',
            sessionStore: MemorySessionStore(),
          ),
          sessionStore: MemorySessionStore(),
        );

  final starts = <String>[];
  final verifies = <String>[];
  final completes = <String>[];
  Object? startError;
  Object? verifyError;
  Object? completeError;
  PhoneSignupChallenge challenge = const PhoneSignupChallenge(
    expiresInSeconds: 60,
    resendAvailableInSeconds: 60,
  );

  bool recoveryAvailable = true;

  @override
  Future<bool> passwordRecoveryAvailable() async => recoveryAvailable;

  @override
  Future<PhoneSignupChallenge> startPasswordRecovery({
    required String phone,
    required String idempotencyKey,
  }) async {
    starts.add('$phone|$idempotencyKey');
    if (startError != null) {
      throw startError!;
    }
    return challenge;
  }

  @override
  Future<String> verifyPasswordRecovery({
    required String phone,
    required String otpCode,
    required String idempotencyKey,
  }) async {
    verifies.add('$phone|$otpCode|$idempotencyKey');
    if (verifyError != null) {
      throw verifyError!;
    }
    return 'recovery-proof-$otpCode';
  }

  @override
  Future<void> completePasswordRecovery({
    required String phone,
    required String recoveryProof,
    required String password,
    required String passwordConfirmation,
    required String idempotencyKey,
  }) async {
    completes.add('$phone|$recoveryProof|$password|$idempotencyKey');
    if (completeError != null) {
      throw completeError!;
    }
  }
}

void main() {
  testWidgets(
    'password recovery phone → OTP → new password → login prompt without auto login',
    (tester) async {
      final repository = _RecoveryRepository();
      final clock = _Clock();
      var keySerial = 0;
      await tester.binding.setSurfaceSize(const Size(400, 900));
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [authRepositoryProvider.overrideWith((ref) => repository)],
          child: MaterialApp(
            theme: AppTheme.app(),
            home: PasswordRecoveryScreen(
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
      await tester.pump();

      expect(find.byKey(const Key('recovery-phone')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('recovery-phone')), '09123334455');
      await tester.ensureVisible(find.text(AppStrings.sendRecoveryCode));
      await tester.tap(find.text(AppStrings.sendRecoveryCode));
      await tester.pump();
      await tester.pump();

      expect(repository.starts, hasLength(1));
      expect(find.byKey(const Key('signup-otp-heading')), findsOneWidget);
      expect(find.text(AppStrings.recoveryOtpHeading), findsOneWidget);

      await tester.enterText(find.byKey(const Key('signup-code')), '222222');
      await tester.pump();
      await tester.ensureVisible(find.byKey(const Key('signup-verify')));
      await tester.tap(find.byKey(const Key('signup-verify')));
      await tester.pump();

      expect(find.byKey(const Key('recovery-password')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('recovery-password')),
        'new-password-value',
      );
      await tester.enterText(
        find.byKey(const Key('recovery-password-confirmation')),
        'new-password-value',
      );
      await tester.tap(find.text(AppStrings.setNewPassword));
      await tester.pump();

      expect(repository.completes, hasLength(1));
      expect(find.text(AppStrings.passwordResetDone), findsOneWidget);
      expect(find.text(AppStrings.signIn), findsOneWidget);
    },
  );

  testWidgets('hides the recovery form when the API reports it unavailable', (
    tester,
  ) async {
    final repository = _RecoveryRepository()..recoveryAvailable = false;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWith((ref) => repository)],
        child: MaterialApp(
          theme: AppTheme.app(),
          home: const PasswordRecoveryScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text(AppStrings.passwordRecoveryUnavailable), findsOneWidget);
    expect(find.byKey(const Key('recovery-phone')), findsNothing);
    expect(repository.starts, isEmpty);
  });
}
