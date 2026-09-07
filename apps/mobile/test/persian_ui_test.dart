import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/features/shell/app_shell.dart';
import 'package:salon_mobile/shared/labels.dart';

void main() {
  testWidgets('shell is RTL with Persian navigation labels', (tester) async {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        ShellRoute(
          builder: (context, state, child) => AppShell(child: child),
          routes: [
            GoRoute(
              path: '/',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/customers',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/visits',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/opportunities',
              builder: (context, state) => const SizedBox.shrink(),
            ),
            GoRoute(
              path: '/profile',
              builder: (context, state) => const SizedBox.shrink(),
            ),
          ],
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp.router(
        locale: AppTheme.locale,
        supportedLocales: AppTheme.supportedLocales,
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: AppTheme.light(),
        routerConfig: router,
      ),
    );

    expect(
      Directionality.of(tester.element(find.byType(AppShell))),
      TextDirection.rtl,
    );
    expect(find.text(AppStrings.dashboard), findsOneWidget);
    expect(find.text(AppStrings.customers), findsOneWidget);
    expect(find.text(AppStrings.visits), findsOneWidget);
    expect(find.text(AppStrings.opportunities), findsOneWidget);
    expect(find.text(AppStrings.profile), findsOneWidget);
    expect(AppStrings.attentionQuestion, 'توجه سالن باید کدام سمت بره؟');
  });
}
