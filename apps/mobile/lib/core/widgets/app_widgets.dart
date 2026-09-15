import 'package:flutter/material.dart';

import '../errors/api_exception.dart';
import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../../shared/labels.dart';

enum AppSurfaceTone { base, elevated, hero }

class AppSurface extends StatelessWidget {
  const AppSurface({
    super.key,
    required this.child,
    this.tone = AppSurfaceTone.base,
    this.padding,
    this.onTap,
    this.radius,
  });

  final Widget child;
  final AppSurfaceTone tone;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      AppSurfaceTone.base => AppTokens.surface,
      AppSurfaceTone.elevated => AppTokens.surfaceElevated,
      AppSurfaceTone.hero => AppTokens.surfaceElevated,
    };
    final resolvedRadius = radius ??
        (tone == AppSurfaceTone.hero ? AppTokens.radiusLg : AppTokens.radiusMd);
    final content = Padding(
      padding: padding ?? const EdgeInsets.all(AppTokens.space16),
      child: child,
    );
    final box = DecoratedBox(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(resolvedRadius),
        border: Border.all(
          color: tone == AppSurfaceTone.hero
              ? AppTokens.accent.withValues(alpha: 0.28)
              : AppTokens.line,
        ),
      ),
      child: content,
    );
    if (onTap == null) {
      return box;
    }
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(resolvedRadius),
        child: box,
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.padding});

  final String title;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding ?? const EdgeInsets.only(bottom: AppTokens.space12),
      child: Text(title, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}

class InsightHero extends StatelessWidget {
  const InsightHero({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AppSurface(
      tone: AppSurfaceTone.hero,
      padding: const EdgeInsets.fromLTRB(
        AppTokens.space16,
        AppTokens.space12,
        AppTokens.space16,
        AppTokens.space12,
      ),
      child: child,
    );
  }
}

enum MetricSize { hero, standard, compact }

class MetricWidget extends StatelessWidget {
  const MetricWidget({
    super.key,
    required this.label,
    required this.value,
    this.valueDirection,
    this.size = MetricSize.standard,
    this.align = CrossAxisAlignment.start,
    this.emphasize = false,
  });

  final String label;
  final Object value;
  final TextDirection? valueDirection;
  final MetricSize size;
  final CrossAxisAlignment align;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final valueStyle = switch (size) {
      MetricSize.hero => theme.textTheme.headlineMedium?.copyWith(
          fontSize: 40,
          height: 0.95,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.4,
          color: emphasize ? AppTokens.accent : null,
          leadingDistribution: TextLeadingDistribution.even,
        ),
      MetricSize.standard => theme.textTheme.headlineSmall,
      MetricSize.compact => theme.textTheme.headlineSmall?.copyWith(
          fontSize: 22,
          height: 1.1,
          fontWeight: FontWeight.w500,
          leadingDistribution: TextLeadingDistribution.even,
        ),
    };
    final valueText = Text(
      '$value',
      style: valueStyle,
      textDirection: valueDirection,
      textAlign: align == CrossAxisAlignment.center
          ? TextAlign.center
          : TextAlign.start,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      textHeightBehavior: const TextHeightBehavior(
        applyHeightToFirstAscent: false,
        applyHeightToLastDescent: false,
      ),
    );
    return Semantics(
      label: '$label $value',
      child: Column(
        crossAxisAlignment: align,
        children: [
          valueText,
          const SizedBox(height: AppTokens.space4),
          Text(
            label,
            style: theme.textTheme.bodySmall,
            textAlign: align == CrossAxisAlignment.center
                ? TextAlign.center
                : TextAlign.start,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

class MetricRow extends StatelessWidget {
  const MetricRow({
    super.key,
    required this.children,
    this.evenColumns = false,
  });

  final List<Widget> children;
  final bool evenColumns;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = evenColumns || constraints.maxWidth >= 520;
        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const SizedBox(width: AppTokens.space12),
                Expanded(child: children[i]),
              ],
            ],
          );
        }
        return Wrap(
          spacing: AppTokens.space24,
          runSpacing: AppTokens.space16,
          children: children
              .map(
                (child) => SizedBox(
                  width: (constraints.maxWidth - AppTokens.space24) / 2,
                  child: child,
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class QuietStat extends StatelessWidget {
  const QuietStat({
    super.key,
    required this.label,
    required this.value,
  });

  final String label;
  final Object value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: '$label $value',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.bodySmall,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppTokens.space4),
          Text(
            '$value',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontSize: 20,
              height: 1,
              fontWeight: FontWeight.w500,
              leadingDistribution: TextLeadingDistribution.even,
            ),
          ),
        ],
      ),
    );
  }
}

class OpportunityPreview extends StatelessWidget {
  const OpportunityPreview({
    super.key,
    required this.name,
    required this.status,
    required this.type,
    required this.reason,
    required this.action,
    this.footer,
    this.onTap,
    this.framed = true,
  });

  final String name;
  final String status;
  final String type;
  final String reason;
  final String action;
  final Widget? footer;
  final VoidCallback? onTap;
  final bool framed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          opportunityLabel(type),
          style: theme.textTheme.titleSmall?.copyWith(color: AppTokens.accent),
        ),
        const SizedBox(height: AppTokens.space8),
        Text(name, style: theme.textTheme.titleMedium),
        const SizedBox(height: AppTokens.space8),
        StatusBadge(status: status),
        const SizedBox(height: AppTokens.space12),
        Text(localizeIntelligenceCopy(reason)),
        const SizedBox(height: AppTokens.space8),
        Text(
          '${AppStrings.recommended}: ${localizeIntelligenceCopy(action)}',
          style: theme.textTheme.bodySmall,
        ),
        if (footer != null) ...[
          const SizedBox(height: AppTokens.space12),
          footer!,
        ],
      ],
    );
    if (framed) {
      return AppSurface(
        tone: AppSurfaceTone.base,
        onTap: onTap,
        child: content,
      );
    }
    final padded = Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space16),
      child: content,
    );
    if (onTap == null) {
      return padded;
    }
    return Material(
      color: Colors.transparent,
      child: InkWell(onTap: onTap, child: padded),
    );
  }
}

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: loading ? null : onPressed,
      child: loading
          ? const SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(label),
    );
  }
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({
    super.key,
    required this.label,
    required this.onPressed,
  });

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(onPressed: onPressed, child: Text(label));
  }
}

class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return PrimaryButton(label: label, onPressed: onPressed, loading: loading);
  }
}

class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    required this.controller,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.textDirection,
  });

  final String label;
  final TextEditingController controller;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextDirection? textDirection;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      textDirection: textDirection,
      decoration: InputDecoration(labelText: label),
    );
  }
}

class LtrText extends StatelessWidget {
  const LtrText(this.value, {super.key, this.style, this.maxLines});

  final String value;
  final TextStyle? style;
  final int? maxLines;

  @override
  Widget build(BuildContext context) {
    return Text(
      value,
      style: style,
      maxLines: maxLines,
      overflow: maxLines == null ? null : TextOverflow.ellipsis,
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.start,
    );
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: SizedBox(
        width: 28,
        height: 28,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
    );
  }
}

class LoadingSkeleton extends StatelessWidget {
  const LoadingSkeleton({super.key, this.lines = 3});

  final int lines;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppTokens.space16),
      child: Column(
        children: [
          for (var i = 0; i < lines; i++) ...[
            Container(
              height: 16,
              width: double.infinity,
              decoration: BoxDecoration(
                color: AppTokens.surfaceElevated,
                borderRadius: BorderRadius.circular(AppTokens.radiusSm),
              ),
            ),
            if (i < lines - 1) const SizedBox(height: AppTokens.space12),
          ],
          const SizedBox(height: AppTokens.space24),
          const LoadingView(),
        ],
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline,
              color: AppTokens.danger,
              size: 28,
            ),
            const SizedBox(height: AppTokens.space12),
            Text(message, textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: AppTokens.space16),
              SecondaryButton(label: AppStrings.retry, onPressed: onRetry),
            ],
          ],
        ),
      ),
    );
  }
}

class EmptyStateView extends StatelessWidget {
  const EmptyStateView({
    super.key,
    required this.title,
    required this.body,
    this.action,
    this.icon = Icons.info_outline,
    this.compact = false,
  });

  final String title;
  final String body;
  final Widget? action;
  final IconData icon;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.symmetric(
        vertical: compact ? AppTokens.space8 : AppTokens.space24,
        horizontal: compact ? 0 : AppTokens.space24,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: compact
            ? CrossAxisAlignment.start
            : CrossAxisAlignment.center,
        children: [
          if (compact)
            Row(
              children: [
                Icon(icon, size: 20, color: AppTokens.textSecondary),
                const SizedBox(width: AppTokens.space8),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            )
          else ...[
            Icon(icon, size: 28, color: AppTokens.textSecondary),
            const SizedBox(height: AppTokens.space12),
            Text(
              title,
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: AppTokens.space8),
          Text(
            body,
            style: theme.textTheme.bodySmall,
            textAlign: compact ? TextAlign.start : TextAlign.center,
          ),
          if (action != null) ...[
            const SizedBox(height: AppTokens.space16),
            action!,
          ],
        ],
      ),
    );
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'AT_RISK' => AppColors.warning,
      'INACTIVE' => AppColors.danger,
      'RETURNING' => AppTokens.accent,
      'ACTIVE' => AppColors.success,
      'NEW' => AppColors.muted,
      _ => AppColors.muted,
    };
    final icon = switch (status) {
      'AT_RISK' => Icons.schedule,
      'INACTIVE' => Icons.hourglass_disabled_outlined,
      'RETURNING' => Icons.replay,
      'ACTIVE' => Icons.check_circle_outline,
      'NEW' => Icons.person_add_alt_outlined,
      _ => Icons.circle_outlined,
    };
    final label = statusLabel(status);
    return Semantics(
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(AppTokens.radiusSm),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: AppTokens.space8),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w500,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    this.valueDirection,
  });

  final String label;
  final Object value;
  final TextDirection? valueDirection;

  @override
  Widget build(BuildContext context) {
    return MetricWidget(
      label: label,
      value: value,
      valueDirection: valueDirection,
    );
  }
}

class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return AppSurface(onTap: onTap, child: child);
  }
}

IconData opportunityTypeIcon(String type) {
  return switch (type) {
    'REVENUE_DECLINE' => Icons.trending_down,
    'REACTIVATION' => Icons.replay,
    'CUSTOMER_RETURN' => Icons.keyboard_return,
    _ => Icons.flag_outlined,
  };
}

Color opportunityTypeEmphasis(String type) {
  return switch (type) {
    'REVENUE_DECLINE' => AppTokens.warning,
    _ => AppTokens.accent,
  };
}

class OpportunityTypeMark extends StatelessWidget {
  const OpportunityTypeMark({super.key, required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final color = opportunityTypeEmphasis(type);
    final label = opportunityLabel(type);
    return Semantics(
      label: label,
      child: Row(
        children: [
          Icon(opportunityTypeIcon(type), size: AppTokens.iconSize, color: color),
          const SizedBox(width: AppTokens.space8),
          Expanded(
            child: Text(
              label,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
                  ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class ActionStatusMark extends StatelessWidget {
  const ActionStatusMark({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'COMPLETED' => AppTokens.success,
      'DISMISSED' => AppTokens.textSecondary,
      'OPEN' => AppTokens.accent,
      _ => AppTokens.textSecondary,
    };
    final icon = switch (status) {
      'COMPLETED' => Icons.check_circle_outline,
      'DISMISSED' => Icons.remove_circle_outline,
      'OPEN' => Icons.flag_outlined,
      _ => Icons.circle_outlined,
    };
    final label = actionStatusLabel(status);
    return Semantics(
      label: label,
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: AppTokens.space8),
          Flexible(
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}

class OpportunityCard extends StatelessWidget {
  const OpportunityCard({
    super.key,
    required this.name,
    required this.status,
    required this.type,
    required this.reason,
    required this.action,
    this.footer,
    this.onTap,
    this.emphasize = false,
  });

  final String name;
  final String status;
  final String type;
  final String reason;
  final String action;
  final Widget? footer;
  final VoidCallback? onTap;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final startSide = Directionality.of(context) == TextDirection.rtl
        ? Border(right: BorderSide(
            color: opportunityTypeEmphasis(type).withValues(alpha: 0.75),
            width: 2,
          ))
        : Border(left: BorderSide(
            color: opportunityTypeEmphasis(type).withValues(alpha: 0.75),
            width: 2,
          ));
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OpportunityTypeMark(type: type),
        const SizedBox(height: AppTokens.space12),
        Text(
          name,
          style: theme.textTheme.titleLarge,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: AppTokens.space8),
        StatusBadge(status: status),
        const SizedBox(height: AppTokens.space12),
        Text(localizeIntelligenceCopy(reason)),
        const SizedBox(height: AppTokens.space12),
        DecoratedBox(
          decoration: BoxDecoration(border: startSide),
          child: Padding(
            padding: const EdgeInsetsDirectional.only(start: AppTokens.space12),
            child: Text(
              '${AppStrings.recommended}: ${localizeIntelligenceCopy(action)}',
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ),
        if (footer != null) ...[
          const SizedBox(height: AppTokens.space16),
          footer!,
        ],
      ],
    );
    if (emphasize) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppTokens.space16),
        child: AppSurface(
          tone: type == 'REVENUE_DECLINE'
              ? AppSurfaceTone.elevated
              : AppSurfaceTone.hero,
          onTap: onTap,
          child: content,
        ),
      );
    }
    final padded = Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space16),
      child: content,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (onTap == null)
          padded
        else
          Material(
            color: Colors.transparent,
            child: InkWell(onTap: onTap, child: padded),
          ),
        const Divider(),
      ],
    );
  }
}

class CustomerListTile extends StatelessWidget {
  const CustomerListTile({
    super.key,
    required this.name,
    required this.phone,
    this.onTap,
  });

  final String name;
  final String phone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      title: Text(name),
      subtitle: LtrText(phone),
      onTap: onTap,
    );
  }
}

String friendlyError(Object error) {
  if (error is ApiException) {
    return error.userMessage;
  }
  if (error is NetworkException) {
    return error.message;
  }
  return AppStrings.genericError;
}

class PagedFooter extends StatelessWidget {
  const PagedFooter({super.key, required this.loading});

  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: loading
            ? const SizedBox(
                height: 24,
                width: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const SizedBox.shrink(),
      ),
    );
  }
}

/// Loads the next cursor page on scroll, and one extra page when the first
/// page does not fill the viewport. Stops as soon as the list can scroll or
/// [hasMore] is false — it does not prefetch the full dataset.
class PagedNotificationListener extends StatefulWidget {
  const PagedNotificationListener({
    super.key,
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
    required this.child,
  });

  final bool hasMore;
  final bool loading;
  final VoidCallback onLoadMore;
  final Widget child;

  @override
  State<PagedNotificationListener> createState() =>
      _PagedNotificationListenerState();
}

class _PagedNotificationListenerState extends State<PagedNotificationListener> {
  final ScrollController _controller = ScrollController();

  @override
  void initState() {
    super.initState();
    _scheduleFill();
  }

  @override
  void didUpdateWidget(covariant PagedNotificationListener oldWidget) {
    super.didUpdateWidget(oldWidget);
    _scheduleFill();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _scheduleFill() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || widget.loading || !widget.hasMore) {
        return;
      }
      if (!_controller.hasClients) {
        return;
      }
      final metrics = _controller.position;
      if (metrics.maxScrollExtent <= 0 ||
          metrics.pixels >= metrics.maxScrollExtent - 240) {
        widget.onLoadMore();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (shouldLoadNextPage(notification)) {
          widget.onLoadMore();
        }
        return false;
      },
      child: PrimaryScrollController(
        controller: _controller,
        child: widget.child,
      ),
    );
  }
}

bool shouldLoadNextPage(ScrollNotification notification) {
  if (notification.metrics.maxScrollExtent <= 0) {
    return false;
  }
  return notification.metrics.pixels >= notification.metrics.maxScrollExtent - 240;
}
