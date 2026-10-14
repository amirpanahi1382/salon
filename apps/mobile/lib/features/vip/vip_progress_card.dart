import 'package:flutter/material.dart';

import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/models/models.dart';

class VipProgressCard extends StatelessWidget {
  const VipProgressCard({super.key, required this.progress, this.action});

  final VipRequestProgress progress;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final tone = switch (progress.nextActor) {
      'SALON' => AppTokens.warning,
      'PLATFORM_ADMIN' => AppTokens.accent,
      _ => AppTokens.textSecondary,
    };
    final icon = switch (progress.nextActor) {
      'SALON' => Icons.storefront_outlined,
      'PLATFORM_ADMIN' => Icons.support_agent_outlined,
      _ => Icons.flag_outlined,
    };
    final latest = progress.latestActionAt;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Semantics(
      container: true,
      label: '${progress.headline}. ${progress.nextActorLabel}. ${progress.explanation}',
      child: AppSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, color: tone, size: AppTokens.iconSize),
                const SizedBox(width: AppTokens.space8),
                Expanded(
                  child: Text(
                    progress.headline,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppTokens.space8),
            Text(
              progress.nextActorLabel,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tone),
            ),
            const SizedBox(height: AppTokens.space8),
            Text(progress.explanation),
            if (progress.listReservationNote != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(
                progress.listReservationNote!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (latest != null && progress.latestActionLabel != null) ...[
              const SizedBox(height: AppTokens.space12),
              Text('${progress.latestActionLabel}: ${formatJalaliDateTime(latest)}'),
            ],
            if (progress.countLines.isNotEmpty) ...[
              const SizedBox(height: AppTokens.space12),
              for (final line in progress.countLines)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTokens.space4),
                  child: Text('${line.label}: ${toPersianDigits(line.count.toString())}'),
                ),
            ],
            if (progress.countsOmittedReason != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(progress.countsOmittedReason!),
            ],
            if (progress.requestedCountNote != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(progress.requestedCountNote!),
            ],
            if (progress.activeStopNote != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(progress.activeStopNote!),
            ],
            if (action != null) ...[
              const SizedBox(height: AppTokens.space12),
              action!,
            ],
          ],
        ),
      ),
      ),
    );
  }
}
