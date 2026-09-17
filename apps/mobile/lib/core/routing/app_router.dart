import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/admin/admin_message_queue_screen.dart';
import '../../features/admin/admin_vip_screen.dart';
import '../../features/auth/auth_screens.dart';
import '../../features/customers/customer_edit_loader.dart';
import '../../features/customers/customer_import_screen.dart';
import '../../features/customers/customer_screens.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/opportunities/opportunities_screen.dart';
import '../../features/profile/profile_screen.dart';
import '../../features/services/service_screens.dart';
import '../../features/shell/app_shell.dart';
import '../../features/visits/visits_screen.dart';
import '../../shared/models/models.dart';
import '../state/providers.dart';

class _AuthRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

final _authRefreshProvider = Provider<_AuthRefresh>((ref) {
  final refresh = _AuthRefresh();
  ref.listen<AuthState>(authControllerProvider, (_, _) => refresh.ping());
  ref.onDispose(refresh.dispose);
  return refresh;
});

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ref.watch(_authRefreshProvider);
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final loggingIn =
          state.matchedLocation == '/login' ||
          state.matchedLocation == '/register' ||
          state.matchedLocation == '/admin/login';
      final splashing = state.matchedLocation == '/splash';
      final isPlatformAdmin = auth.user?.isPlatformAdmin == true;
      final onAdmin = state.matchedLocation.startsWith('/admin') &&
          state.matchedLocation != '/admin/login';
      if (auth.status == AuthStatus.unknown) {
        return splashing ? null : '/splash';
      }
      if (auth.status == AuthStatus.signedOut) {
        return loggingIn ? null : '/login';
      }
      if (isPlatformAdmin) {
        if (loggingIn || splashing || !onAdmin) {
          return '/admin/messages';
        }
        return null;
      }
      if (onAdmin) {
        return '/';
      }
      if (loggingIn || splashing) {
        return '/';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/admin/login',
        builder: (context, state) => const PlatformAdminLoginScreen(),
      ),
      GoRoute(
        path: '/admin/messages',
        builder: (context, state) => const AdminMessageQueueScreen(),
      ),
      GoRoute(
        path: '/admin/vip',
        builder: (context, state) => const AdminVipScreen(),
      ),
      GoRoute(
        path: '/admin/vip/:id',
        builder: (context, state) => AdminVipListDetailScreen(
          listId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/customers',
            builder: (context, state) => const CustomersScreen(),
          ),
          GoRoute(
            path: '/visits',
            builder: (context, state) => const VisitsScreen(),
          ),
          GoRoute(
            path: '/opportunities',
            builder: (context, state) => const OpportunitiesScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/profile/services',
            builder: (context, state) => const ServiceManagementScreen(),
          ),
          GoRoute(
            path: '/profile/services/new',
            builder: (context, state) => const ServiceFormScreen(),
          ),
          GoRoute(
            path: '/profile/services/:id/edit',
            builder: (context, state) {
              final extra = state.extra;
              if (extra is SalonService) {
                return ServiceFormScreen(service: extra);
              }
              return const ServiceManagementScreen();
            },
          ),
        ],
      ),
      GoRoute(
        path: '/customers/new',
        builder: (context, state) => const CustomerFormScreen(),
      ),
      GoRoute(
        path: '/customers/import',
        builder: (context, state) => const CustomerImportScreen(),
      ),
      GoRoute(
        path: '/customers/:id',
        builder: (context, state) =>
            CustomerDetailScreen(customerId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/customers/:id/edit',
        builder: (context, state) {
          final extra = state.extra;
          if (extra is Customer) {
            return CustomerFormScreen(customer: extra);
          }
          return CustomerEditLoader(customerId: state.pathParameters['id']!);
        },
      ),
      GoRoute(
        path: '/customers/:id/record-visit',
        builder: (context, state) {
          final extra = state.extra;
          return RecordVisitScreen(
            customerId: state.pathParameters['id']!,
            commitment: extra is ReturnCommitment ? extra : null,
          );
        },
      ),
    ],
  );
});
