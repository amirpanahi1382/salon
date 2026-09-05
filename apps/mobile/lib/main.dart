import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/routing/app_router.dart';
import 'core/state/providers.dart';
import 'core/theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: SalonApp()));
}

class SalonApp extends ConsumerStatefulWidget {
  const SalonApp({super.key});

  @override
  ConsumerState<SalonApp> createState() => _SalonAppState();
}

class _SalonAppState extends ConsumerState<SalonApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(authControllerProvider.notifier).restore());
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Salon Attention',
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
