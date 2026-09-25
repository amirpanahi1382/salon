import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_tokens.dart';
import '../../shared/labels.dart';

class AdminMessagingShell extends StatelessWidget {
  const AdminMessagingShell({
    super.key,
    required this.child,
  });

  final Widget child;

  int _index(BuildContext context) {
    if (GoRouter.maybeOf(context) == null) {
      return 0;
    }
    final location = GoRouterState.of(context).uri.path;
    if (location.startsWith('/admin/vip')) {
      return 1;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final selected = _index(context);
    return Scaffold(
      body: child,
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: AppTokens.surface,
          border: Border(top: BorderSide(color: AppTokens.line)),
        ),
        child: NavigationBar(
          selectedIndex: selected,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.chat_bubble_outline),
              selectedIcon: Icon(Icons.chat_bubble),
              label: AppStrings.adminQueueTitle,
            ),
            NavigationDestination(
              icon: Icon(Icons.workspace_premium_outlined),
              selectedIcon: Icon(Icons.workspace_premium),
              label: AppStrings.adminVipMessagingTitle,
            ),
          ],
          onDestinationSelected: (index) {
            if (GoRouter.maybeOf(context) == null) {
              return;
            }
            if (index == 0) {
              context.go('/admin/messages');
            } else {
              context.go('/admin/vip/outreach');
            }
          },
        ),
      ),
    );
  }
}
