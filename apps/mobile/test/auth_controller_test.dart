import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/shared/models/models.dart';

class _FakeAuthRepository extends AuthRepository {
  _FakeAuthRepository()
    : super(
        api: ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
        sessionStore: MemorySessionStore(),
      );

  StoredSession? stored;
  AuthSession? nextSession;
  Object? nextError;

  @override
  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    if (nextError != null) {
      throw nextError!;
    }
    return nextSession!;
  }

  @override
  Future<AuthUser> me() async {
    if (nextError != null) {
      throw nextError!;
    }
    return nextSession!.user;
  }

  @override
  Future<StoredSession?> restore() async => stored;

  @override
  Future<void> logout() async {
    stored = null;
  }
}

AuthSession _session() {
  return const AuthSession(
    accessToken: 'token',
    user: AuthUser(
      id: 'u1',
      tenantId: 't1',
      role: 'OWNER',
      name: 'Leila',
      email: 'leila@example.test',
    ),
  );
}

void main() {
  test('login success then logout', () async {
    final auth = _FakeAuthRepository()..nextSession = _session();
    final container = ProviderContainer(
      overrides: [authRepositoryProvider.overrideWith((ref) => auth)],
    );
    addTearDown(container.dispose);

    await container
        .read(authControllerProvider.notifier)
        .login('leila@example.test', 'password1');
    expect(container.read(authControllerProvider).status, AuthStatus.signedIn);
    expect(container.read(authControllerProvider).user?.name, 'Leila');

    await container.read(authControllerProvider.notifier).logout();
    expect(container.read(authControllerProvider).status, AuthStatus.signedOut);
  });

  test('session restoration uses stored session and /auth/me', () async {
    final auth = _FakeAuthRepository()
      ..stored = const StoredSession(
        accessToken: 'token',
        userId: 'u1',
        tenantId: 't1',
        role: 'OWNER',
        name: 'Leila',
        email: 'leila@example.test',
      )
      ..nextSession = _session();
    final container = ProviderContainer(
      overrides: [authRepositoryProvider.overrideWith((ref) => auth)],
    );
    addTearDown(container.dispose);

    await container.read(authControllerProvider.notifier).restore();
    expect(container.read(authControllerProvider).status, AuthStatus.signedIn);
    expect(container.read(authControllerProvider).user?.id, 'u1');
  });

  test('invalid stored session signs the user out', () async {
    final auth = _FakeAuthRepository()
      ..stored = const StoredSession(
        accessToken: 'expired',
        userId: 'u1',
        tenantId: 't1',
        role: 'OWNER',
      )
      ..nextError = const ApiException(
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'expired',
      );
    final container = ProviderContainer(
      overrides: [authRepositoryProvider.overrideWith((ref) => auth)],
    );
    addTearDown(container.dispose);

    await container.read(authControllerProvider.notifier).restore();
    expect(container.read(authControllerProvider).status, AuthStatus.signedOut);
  });
}
