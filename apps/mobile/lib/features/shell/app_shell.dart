import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_tokens.dart';
import '../../shared/labels.dart';

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.child});

  final Widget child;

  int _index(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    if (location.startsWith('/customers')) {
      return 1;
    }
    if (location.startsWith('/visits')) {
      return 2;
    }
    if (location.startsWith('/opportunities')) {
      return 3;
    }
    if (location.startsWith('/profile')) {
      return 4;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: AppTokens.surface,
          border: Border(top: BorderSide(color: AppTokens.line)),
        ),
        child: NavigationBar(
          selectedIndex: _index(context),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.wb_sunny_outlined),
              selectedIcon: Icon(Icons.wb_sunny),
              label: AppStrings.dashboard,
            ),
            NavigationDestination(
              icon: Icon(Icons.people_outline),
              selectedIcon: Icon(Icons.people),
              label: AppStrings.customers,
            ),
            NavigationDestination(
              icon: Icon(Icons.history),
              selectedIcon: Icon(Icons.history),
              label: AppStrings.visits,
            ),
            NavigationDestination(
              icon: Icon(Icons.flag_outlined),
              selectedIcon: Icon(Icons.flag),
              label: AppStrings.opportunities,
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: AppStrings.profile,
            ),
          ],
          onDestinationSelected: (index) {
            switch (index) {
              case 0:
                context.go('/');
              case 1:
                context.go('/customers');
              case 2:
                context.go('/visits');
              case 3:
                context.go('/opportunities');
              case 4:
                context.go('/profile');
            }
          },
        ),
      ),
    );
  }
}
