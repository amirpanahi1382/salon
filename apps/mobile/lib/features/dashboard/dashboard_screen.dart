import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../recovery/open_agreed_returns_screen.dart';
import 'dashboard_widgets.dart';
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
      return const Scaffold(
        body: Stack(
          children: [
            Positioned.fill(child: DashboardBackdrop()),
            SafeArea(child: LoadingSkeleton(lines: 4)),
          ],
        ),
      );
    }
    if (_error != null && _performance == null) {
      return Scaffold(
        body: Stack(
          children: [
            const Positioned.fill(child: DashboardBackdrop()),
            SafeArea(
              child: ErrorView(
                message: friendlyError(_error!),
                onRetry: _load,
              ),
            ),
          ],
        ),
      );
    }
    final performance = _performance!;
    final isStaff = user?.role == 'STAFF';
    final displayName = _salon?.name ?? user?.name ?? AppStrings.appName;
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: DashboardBackdrop()),
          SafeArea(
            bottom: false,
            child: RefreshIndicator(
              onRefresh: _load,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final extra =
                      constraints.maxWidth > AppTokens.contentMaxWidth
                      ? (constraints.maxWidth - AppTokens.contentMaxWidth) / 2
                      : AppTokens.space16;
                  final pad = extra.clamp(AppTokens.space16, 80.0);
                  return ListView(
                    primary: true,
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: EdgeInsets.fromLTRB(
                      pad,
                      AppTokens.space12,
                      pad,
                      AppTokens.space32,
                    ),
                    children: [
                      _DashboardHeader(name: displayName),
                      const SizedBox(height: AppTokens.space20),
                      OverallPerformanceCard(
                        performance: performance,
                        onResultsTap: () => context.push('/follow-ups'),
                      ),
                      const SizedBox(height: AppTokens.space16),
                      _FirstActionCard(
                        onTap: () => context.push('/follow-ups'),
                      ),
                      if (isStaff) ...[
                        const SizedBox(height: AppTokens.space16),
                        OpenAgreedReturnsEntry(
                          onTap: () => context.push('/open-returns'),
                        ),
                      ],
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DashboardHeader extends StatelessWidget {
  const _DashboardHeader({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(
              colors: [
                AppTokens.accent.withValues(alpha: 0.22),
                AppTokens.surfaceElevated.withValues(alpha: 0.92),
              ],
            ),
            border: Border.all(
              color: AppTokens.accent.withValues(alpha: 0.65),
              width: 1.4,
            ),
            boxShadow: [
              BoxShadow(
                color: AppTokens.accent.withValues(alpha: 0.16),
                blurRadius: 14,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: const Icon(
            Icons.person_outline_rounded,
            color: AppTokens.accent,
            size: 28,
          ),
        ),
        const SizedBox(width: AppTokens.space12),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                AppStrings.dashboardWelcome,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: AppTokens.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _FirstActionCard extends StatelessWidget {
  const _FirstActionCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DashboardGlassPanel(
      accent: DashboardAccent.copper,
      padding: const EdgeInsets.all(AppTokens.space16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      AppStrings.dashboardFirstActionTitle,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: AppTokens.space4),
                    Text(
                      AppStrings.dashboardFirstActionBody,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppTokens.textSecondary,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppTokens.space12),
              const DashboardIconTile(
                icon: Icons.fact_check_outlined,
                accent: DashboardAccent.copper,
                size: 58,
                iconSize: 27,
                prominent: true,
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space16),
          Align(
            alignment: Alignment.centerLeft,
            child: _CopperButton(
              label: AppStrings.dashboardFirstActionButton,
              onTap: onTap,
            ),
          ),
        ],
      ),
    );
  }
}

class _CopperButton extends StatelessWidget {
  const _CopperButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final radius = BorderRadius.circular(999);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: const LinearGradient(
          begin: Alignment.centerRight,
          end: Alignment.centerLeft,
          colors: [AppTokens.accent, AppTokens.accentDeep],
        ),
        boxShadow: [
          BoxShadow(
            color: AppTokens.accent.withValues(alpha: 0.22),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: AppTokens.buttonHeight,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTokens.space20,
                  vertical: AppTokens.space12,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        label,
                        style: theme.textTheme.labelLarge?.copyWith(
                          color: AppTokens.onAccent,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppTokens.space8),
                    const Icon(
                      Icons.chevron_left_rounded,
                      color: AppTokens.onAccent,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
