import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/api_config.dart';
import '../networking/api_client.dart';
import '../networking/repositories.dart';
import '../storage/session_store.dart';
import '../../shared/models/models.dart';
import '../../shared/platform/excel_file_saver.dart';

final apiConfigProvider = Provider<ApiConfig>(
  (ref) => ApiConfig.fromEnvironment(),
);

final sessionStoreProvider = Provider<SessionStore>(
  (ref) => SecureSessionStore(),
);

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ref.watch(apiConfigProvider).baseUrl,
    sessionStore: ref.watch(sessionStoreProvider),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    api: ref.watch(apiClientProvider),
    sessionStore: ref.watch(sessionStoreProvider),
  );
});

final customerRepositoryProvider = Provider<CustomerRepository>((ref) {
  return CustomerRepository(ref.watch(apiClientProvider));
});

final visitRepositoryProvider = Provider<VisitRepository>((ref) {
  return VisitRepository(ref.watch(apiClientProvider));
});

final visitExcelSaverProvider = Provider<ExcelFileSaver>(
  (ref) => saveExcelFile,
);

final intelligenceRepositoryProvider = Provider<IntelligenceRepository>((ref) {
  return IntelligenceRepository(ref.watch(apiClientProvider));
});

final actionRepositoryProvider = Provider<ActionRepository>((ref) {
  return ActionRepository(ref.watch(apiClientProvider));
});

final messageRepositoryProvider = Provider<MessageRepository>((ref) {
  return MessageRepository(ref.watch(apiClientProvider));
});

final opportunitiesRepositoryProvider = Provider<OpportunitiesRepository>((ref) {
  return OpportunitiesRepository(ref.watch(apiClientProvider));
});

final returnCommitmentRepositoryProvider = Provider<ReturnCommitmentRepository>((
  ref,
) {
  return ReturnCommitmentRepository(ref.watch(apiClientProvider));
});

final adminMessageRepositoryProvider = Provider<AdminMessageRepository>((ref) {
  return AdminMessageRepository(ref.watch(apiClientProvider));
});

final vipRepositoryProvider = Provider<VipRepository>((ref) {
  return VipRepository(ref.watch(apiClientProvider));
});

final salonRepositoryProvider = Provider<SalonRepository>((ref) {
  return SalonRepository(ref.watch(apiClientProvider));
});

final serviceRepositoryProvider = Provider<ServiceRepository>((ref) {
  return ServiceRepository(ref.watch(apiClientProvider));
});

final transactionRepositoryProvider = Provider<TransactionRepository>((ref) {
  return TransactionRepository(ref.watch(apiClientProvider));
});

enum AuthStatus { unknown, signedOut, signedIn }

class AuthState {
  const AuthState({required this.status, this.user, this.message});

  final AuthStatus status;
  final AuthUser? user;
  final String? message;

  bool get isSignedIn => status == AuthStatus.signedIn;
}

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() => const AuthState(status: AuthStatus.unknown);

  Future<void> restore() async {
    final stored = await ref.read(authRepositoryProvider).restore();
    if (stored == null) {
      state = const AuthState(status: AuthStatus.signedOut);
      return;
    }
    try {
      final me = await ref.read(authRepositoryProvider).me();
      state = AuthState(
        status: AuthStatus.signedIn,
        user: AuthUser(
          id: me.id,
          tenantId: me.tenantId,
          role: me.role,
          name: stored.name,
          email: stored.email,
        ),
      );
    } catch (_) {
      await ref.read(authRepositoryProvider).logout();
      state = const AuthState(status: AuthStatus.signedOut);
    }
  }

  Future<void> login(String email, String password) async {
    final session = await ref
        .read(authRepositoryProvider)
        .login(email: email, password: password);
    state = AuthState(status: AuthStatus.signedIn, user: session.user);
  }

  Future<void> loginPlatformAdmin(String email, String password) async {
    final session = await ref
        .read(authRepositoryProvider)
        .loginPlatformAdmin(email: email, password: password);
    state = AuthState(status: AuthStatus.signedIn, user: session.user);
  }

  Future<void> register({
    required String salonName,
    required String ownerName,
    required String email,
    required String password,
  }) async {
    final session = await ref
        .read(authRepositoryProvider)
        .register(
          salonName: salonName,
          ownerName: ownerName,
          email: email,
          password: password,
        );
    state = AuthState(status: AuthStatus.signedIn, user: session.user);
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    state = const AuthState(status: AuthStatus.signedOut);
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
