import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../recovery/open_agreed_returns_screen.dart';
import 'overall_performance_card.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  SalonOverallPerformance? _performance;
  SalonProfile? _salon;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final salonRepo = ref.read(salonRepositoryProvider);
      final salon = await salonRepo.current();
      final performance = await salonRepo.overallPerformance();
      if (!mounted) {
        return;
      }
      setState(() {
        _salon = salon;
        _performance = performance;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).user;
    if (_loading && _performance == null) {
      return const Scaffold(body: LoadingSkeleton(lines: 4));
    }
    if (_error != null && _performance == null) {
      return Scaffold(
        body: ErrorView(message: friendlyError(_error!), onRetry: _load),
      );
    }
    final performance = _performance!;
    final theme = Theme.of(context);
    final isOwnerOrManager = user?.role == 'OWNER' || user?.role == 'MANAGER';
    final isStaff = user?.role == 'STAFF';
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 64,
        titleSpacing: AppTokens.space16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              _salon?.name ?? AppStrings.appName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (user?.name != null)
              Text(
                user!.name!,
                style: theme.textTheme.bodySmall,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final extra = constraints.maxWidth > AppTokens.contentMaxWidth
                ? (constraints.maxWidth - AppTokens.contentMaxWidth) / 2
                : AppTokens.space16;
            final pad = extra.clamp(AppTokens.space16, 80.0);
            return ListView(
              primary: true,
              padding: EdgeInsets.fromLTRB(
                pad,
                AppTokens.space8,
                pad,
                AppTokens.space32,
              ),
              children: [
                OverallPerformanceCard(performance: performance),
                const SizedBox(height: AppTokens.space24),
                if (isOwnerOrManager)
                  AppSurface(
                    onTap: () => context.push('/recovery'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          AppStrings.recoveryOutcomesTitle,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppTokens.space8),
                        Text(
                          AppStrings.recoveryOutcomesOpen,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                if (isStaff)
                  OpenAgreedReturnsEntry(
                    onTap: () => context.push('/open-returns'),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
