import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/auth/auth_screens.dart';
import 'package:salon_mobile/shared/labels.dart';

class _Call {
  _Call(this.phone, this.key, [this.extra = '']);

  final String phone;
  final String key;
  final String extra;
}

class _SignupRepository extends AuthRepository {
  _SignupRepository()
    : super(
        api: ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
        sessionStore: MemorySessionStore(),
      );

  final starts = <_Call>[];
  final verifies = <_Call>[];
  final completes = <_Call>[];
  Object? startError;
  Object? verifyError;
  Object? completeError;

  @override
  Future<void> startPhoneSignup({
    required String phone,
    required String idempotencyKey,
  }) async {
    starts.add(_Call(phone, idempotencyKey));
    if (startError != null) {
      throw startError!;
    }
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

  @override
  Future<void> completePhoneSignup({
    required String phone,
    required String signupProof,
    required String salonName,
    required String ownerName,
    required String password,
    required String passwordConfirmation,
    required String idempotencyKey,
  }) async {
    completes.add(
      _Call(
        phone,
        idempotencyKey,
        '$signupProof|$salonName|$ownerName|$password|$passwordConfirmation',
      ),
    );
    if (completeError != null) {
      throw completeError!;
    }
  }
}

Future<void> _pump(WidgetTester tester, _SignupRepository auth) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [authRepositoryProvider.overrideWith((ref) => auth)],
      child: const MaterialApp(home: RegisterScreen()),
    ),
  );
}

void main() {
  testWidgets('a new send and a changed phone each get a new key', (tester) async {
    final auth = _SignupRepository()
      ..startError = const ApiException(
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Enter an Iranian mobile number.',
      );
    await _pump(tester, auth);

    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000001');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();

    expect(auth.starts, hasLength(2));
    expect(auth.starts[0].key, isNot(auth.starts[1].key));
    expect(auth.starts[0].phone, '09120000001');
    expect(auth.starts[1].phone, '09120000001');

    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000002');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();
    expect(auth.starts, hasLength(3));
    expect(auth.starts.last.phone, '09120000002');
    expect(auth.starts.last.key, isNot(auth.starts[1].key));
  });

  testWidgets('an ambiguous send retries the original key and phone', (tester) async {
    final auth = _SignupRepository()..startError = const NetworkException();
    await _pump(tester, auth);
    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000003');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-phone')), '09129999999');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();

    expect(auth.starts, hasLength(2));
    expect(auth.starts[1].key, auth.starts[0].key);
    expect(auth.starts[1].phone, '09120000003');
  });

  testWidgets('a wrong code starts a new verification attempt', (tester) async {
    final auth = _SignupRepository();
    await _pump(tester, auth);
    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000004');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();

    auth.verifyError = const ApiException(
      statusCode: 400,
      code: 'SIGNUP_VERIFICATION_FAILED',
      message: 'The signup code could not be verified.',
    );
    await tester.enterText(find.byKey(const Key('signup-code')), '111111');
    await tester.tap(find.text(AppStrings.verifySignupCode));
    await tester.pump();
    await tester.tap(find.text(AppStrings.verifySignupCode));
    await tester.pump();

    expect(auth.verifies, hasLength(2));
    expect(auth.verifies[0].extra, '111111');
    expect(auth.verifies[1].key, isNot(auth.verifies[0].key));
    expect(auth.verifies[1].extra, '111111');
  });

  testWidgets('an ambiguous verification retries the original code', (tester) async {
    final auth = _SignupRepository()
      ..verifyError = const ApiException(
        statusCode: 409,
        code: 'SIGNUP_VERIFICATION_UNCONFIRMED',
        message: 'unconfirmed',
      );
    await _pump(tester, auth);
    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000005');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-code')), '222222');
    await tester.tap(find.text(AppStrings.verifySignupCode));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-code')), '333333');
    await tester.tap(find.text(AppStrings.verifySignupCode));
    await tester.pump();

    expect(auth.verifies, hasLength(2));
    expect(auth.verifies[1].key, auth.verifies[0].key);
    expect(auth.verifies[1].extra, '222222');
  });

  testWidgets('changed completion details use a new key', (tester) async {
    final auth = _SignupRepository()
      ..completeError = const ApiException(
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Enter the same password in both fields.',
      );
    await _pump(tester, auth);
    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000006');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-code')), '444444');
    await tester.tap(find.text(AppStrings.verifySignupCode));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-salon')), 'سالن اول');
    await tester.enterText(find.byKey(const Key('signup-owner')), 'مالک');
    await tester.enterText(find.byKey(const Key('signup-password')), 'password-one');
    await tester.enterText(
      find.byKey(const Key('signup-password-confirmation')),
      'password-one',
    );
    await tester.tap(find.text(AppStrings.createAccount));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-salon')), 'سالن دوم');
    await tester.tap(find.text(AppStrings.createAccount));
    await tester.pump();

    expect(auth.completes, hasLength(2));
    expect(auth.completes[1].key, isNot(auth.completes[0].key));
    expect(auth.completes[0].extra, contains('سالن اول'));
    expect(auth.completes[1].extra, contains('سالن دوم'));
  });

  testWidgets('an ambiguous completion retries the original body', (tester) async {
    final auth = _SignupRepository()..completeError = const NetworkException();
    await _pump(tester, auth);
    await tester.enterText(find.byKey(const Key('signup-phone')), '09120000007');
    await tester.tap(find.byKey(const Key('signup-submit')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-code')), '555555');
    await tester.tap(find.text(AppStrings.verifySignupCode));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-salon')), 'سالن ثابت');
    await tester.enterText(find.byKey(const Key('signup-owner')), 'مالک');
    await tester.enterText(find.byKey(const Key('signup-password')), 'password-two');
    await tester.enterText(
      find.byKey(const Key('signup-password-confirmation')),
      'password-two',
    );
    await tester.tap(find.text(AppStrings.createAccount));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('signup-salon')), 'سالن عوض‌شده');
    await tester.enterText(find.byKey(const Key('signup-password')), 'password-other');
    await tester.tap(find.text(AppStrings.createAccount));
    await tester.pump();

    expect(auth.completes, hasLength(2));
    expect(auth.completes[1].key, auth.completes[0].key);
    expect(auth.completes[1].extra, auth.completes[0].extra);
    expect(auth.completes[1].extra, contains('سالن ثابت'));
    expect(auth.completes[1].extra, contains('password-two'));
  });
}
