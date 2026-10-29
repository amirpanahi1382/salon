import 'package:flutter/material.dart';

import '../../core/theme/app_tokens.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'dashboard_widgets.dart';

class OverallPerformanceCard extends StatelessWidget {
  const OverallPerformanceCard({
    super.key,
    required this.performance,
    this.onResultsTap,
  });

  final SalonOverallPerformance performance;
  final VoidCallback? onResultsTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _DashboardHero(),
        const SizedBox(height: AppTokens.space16),
        _MetricGrid(performance: performance),
        const SizedBox(height: AppTokens.space16),
        _MessageResultsPanel(
          performance: performance,
          onResultsTap: onResultsTap,
        ),
      ],
    );
  }
}

class _DashboardHero extends StatelessWidget {
  const _DashboardHero();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DashboardGlassPanel(
      accent: DashboardAccent.copper,
      prominent: true,
      padding: const EdgeInsets.fromLTRB(
        AppTokens.space20,
        AppTokens.space20,
        AppTokens.space20,
        AppTokens.space20,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  AppStrings.dashboardHeroTitle,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontSize: 25,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                  textAlign: TextAlign.start,
                ),
                const SizedBox(height: AppTokens.space8),
                Text(
                  AppStrings.dashboardHeroSubtitle,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: AppTokens.textSecondary,
                    height: 1.45,
                  ),
                  textAlign: TextAlign.start,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTokens.space16),
          const DashboardIconTile(
            icon: Icons.calendar_month_outlined,
            accent: DashboardAccent.copper,
            size: 64,
            iconSize: 30,
            prominent: true,
          ),
        ],
      ),
    );
  }
}

class _Metric {
  const _Metric({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
    this.tag,
    this.money = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final DashboardAccent accent;
  final String? tag;
  final bool money;
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.performance});

  final SalonOverallPerformance performance;

  @override
  Widget build(BuildContext context) {
    final metrics = [
      _Metric(
        icon: Icons.people_alt_outlined,
        label: AppStrings.metricSalonCustomers,
        value: toPersianDigits(performance.customerCount.toString()),
        accent: DashboardAccent.purple,
        tag: AppStrings.dashboardTotalTag,
      ),
      _Metric(
        icon: Icons.mail_outline_rounded,
        label: AppStrings.dashboardSalonMessages,
        value: toPersianDigits(
          performance.salonCustomerSentMessageCount.toString(),
        ),
        accent: DashboardAccent.copper,
        tag: AppStrings.dashboardTotalTag,
      ),
      _Metric(
        icon: Icons.workspace_premium_outlined,
        label: AppStrings.dashboardVipMessages,
        value: toPersianDigits(performance.vipSentMessageCount.toString()),
        accent: DashboardAccent.purple,
        tag: AppStrings.dashboardTotalTag,
      ),
      _Metric(
        icon: Icons.event_available_outlined,
        label: AppStrings.metricAgreedReturns,
        value: toPersianDigits(performance.agreedReturnCount.toString()),
        accent: DashboardAccent.green,
        tag: AppStrings.dashboardAgreedTag,
      ),
      _Metric(
        icon: Icons.payments_outlined,
        label: AppStrings.dashboardMonthlyRevenue,
        value: formatDashboardIrr(performance.monthlyRecordedRevenueIrr),
        accent: DashboardAccent.green,
        tag: AppStrings.dashboardThisMonthTag,
        money: true,
      ),
      _Metric(
        icon: Icons.replay_rounded,
        label: AppStrings.metricMessageAssociatedReturns,
        value: toPersianDigits(
          performance.messageAssociatedReturnedCustomerCount.toString(),
        ),
        accent: DashboardAccent.copper,
        tag: AppStrings.dashboardTotalTag,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _MetricRow(leading: metrics[0], trailing: metrics[1]),
        const SizedBox(height: AppTokens.space12),
        _MetricRow(leading: metrics[2], trailing: metrics[3]),
        const SizedBox(height: AppTokens.space12),
        _MetricRow(leading: metrics[4], trailing: metrics[5]),
      ],
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({required this.leading, required this.trailing});

  /// The leading card sits at the visual right in RTL.
  final _Metric leading;
  final _Metric trailing;

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: _MetricTile(metric: leading)),
          const SizedBox(width: AppTokens.space12),
          Expanded(child: _MetricTile(metric: trailing)),
        ],
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({required this.metric});

  final _Metric metric;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final valueStyle =
        (metric.money ? theme.textTheme.titleLarge : theme.textTheme.headlineSmall)
            ?.copyWith(
              fontSize: metric.money ? 20 : 28,
              fontWeight: FontWeight.w600,
              height: 1.15,
              leadingDistribution: TextLeadingDistribution.even,
            );
    final valueText = metric.money
        ? Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(metric.value, maxLines: 1, style: valueStyle),
              const SizedBox(width: 4),
              Text(
                AppStrings.rial,
                maxLines: 1,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: AppTokens.textSecondary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          )
        : Text(metric.value, maxLines: 1, style: valueStyle);
    return DashboardGlassPanel(
      accent: metric.accent,
      radius: AppTokens.radiusLg,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: AlignmentDirectional.centerStart,
                      child: valueText,
                    ),
                    if (metric.tag != null) ...[
                      const SizedBox(height: 6),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: DashboardTag(
                          text: metric.tag!,
                          accent: metric.accent,
                          tone: metric.accent == DashboardAccent.green
                              ? DashboardTagTone.outlined
                              : DashboardTagTone.filled,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: AppTokens.space8),
              DashboardIconTile(
                icon: metric.icon,
                accent: metric.accent,
                size: 44,
                iconSize: 22,
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space8),
          Text(
            metric.label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTokens.textSecondary,
              fontWeight: FontWeight.w500,
            ),
            textAlign: TextAlign.start,
          ),
        ],
      ),
    );
  }
}

class _MessageResultsPanel extends StatelessWidget {
  const _MessageResultsPanel({
    required this.performance,
    this.onResultsTap,
  });

  final SalonOverallPerformance performance;
  final VoidCallback? onResultsTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DashboardGlassPanel(
      accent: DashboardAccent.purple,
      padding: const EdgeInsets.all(AppTokens.space16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const DashboardIconTile(
                icon: Icons.format_list_bulleted_rounded,
                accent: DashboardAccent.copper,
                size: 36,
                iconSize: 20,
              ),
              const SizedBox(width: AppTokens.space12),
              Expanded(
                child: Text(
                  AppStrings.dashboardMessageResultsTitle,
                  style: theme.textTheme.titleMedium,
                  textAlign: TextAlign.start,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space12),
          Container(
            decoration: BoxDecoration(
              color: AppTokens.bg.withValues(alpha: 0.30),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: AppTokens.line.withValues(alpha: 0.72),
              ),
            ),
            child: Column(
              children: [
                _MessageResultRow(
                  icon: Icons.mail_outline_rounded,
                  title: AppStrings.dashboardSalonMessages,
                  sent: performance.salonCustomerSentMessageCount,
                  requested: performance.salonCustomerMessageRequestCount,
                  accent: DashboardAccent.copper,
                  onTap: onResultsTap,
                ),
                Divider(
                  height: 1,
                  thickness: 1,
                  color: AppTokens.line.withValues(alpha: 0.58),
                ),
                _MessageResultRow(
                  icon: Icons.workspace_premium_outlined,
                  title: AppStrings.dashboardVipMessages,
                  sent: performance.vipSentMessageCount,
                  requested: performance.vipMessageRequestCount,
                  accent: DashboardAccent.green,
                  onTap: onResultsTap,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageResultRow extends StatelessWidget {
  const _MessageResultRow({
    required this.icon,
    required this.title,
    required this.sent,
    required this.requested,
    required this.accent,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final int sent;
  final int requested;
  final DashboardAccent accent;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: accent.color, size: 22),
        const SizedBox(width: AppTokens.space8),
        Flexible(
          child: Text(
            title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTokens.textPrimary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
    final sentTag = DashboardTag(
      text:
          '${toPersianDigits(sent.toString())} ${AppStrings.dashboardSentTag}',
      accent: accent,
    );
    final requestTag = DashboardTag(
      text: AppStrings.dashboardRequestedTag(requested),
      accent: DashboardAccent.purple,
      tone: DashboardTagTone.outlined,
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final compact = constraints.maxWidth < 350 || scale > 1.12;
        final content = compact
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(child: label),
                      if (onTap != null) const DashboardChevron(),
                    ],
                  ),
                  const SizedBox(height: AppTokens.space8),
                  Wrap(
                    spacing: AppTokens.space8,
                    runSpacing: AppTokens.space8,
                    alignment: WrapAlignment.start,
                    children: [sentTag, requestTag],
                  ),
                ],
              )
            : Row(
                children: [
                  Expanded(child: label),
                  sentTag,
                  const SizedBox(width: AppTokens.space8),
                  requestTag,
                  if (onTap != null) ...[
                    const SizedBox(width: AppTokens.space8),
                    const DashboardChevron(),
                  ],
                ],
              );
        final padded = Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space12,
            vertical: AppTokens.space12,
          ),
          child: content,
        );
        if (onTap == null) {
          return padded;
        }
        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(16),
            child: padded,
          ),
        );
      },
    );
  }
}
