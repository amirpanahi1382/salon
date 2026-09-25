import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../../shared/phone_launcher.dart';
import 'recovery_presentation.dart';

class OpenAgreedReturnsSection extends ConsumerWidget {
  const OpenAgreedReturnsSection({
    super.key,
    required this.items,
    required this.loading,
    this.error,
    this.onRetry,
  });

  final List<OpenAgreedReturn> items;
  final bool loading;
  final Object? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(AppStrings.openAgreedReturnsTitle),
        const SizedBox(height: AppTokens.space8),
        Text(AppStrings.openAgreedReturnsHint, style: theme.textTheme.bodySmall),
        const SizedBox(height: AppTokens.space12),
        if (loading && items.isEmpty)
          const LoadingSkeleton(lines: 2)
        else if (items.isEmpty && error == null)
          const EmptyStateView(
            title: AppStrings.openAgreedReturnsEmpty,
            body: AppStrings.openAgreedReturnsEmpty,
            compact: true,
          )
        else
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space8),
              child: AppSurface(
                onTap: () => context.push('/customers/${item.customerId}'),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(item.customerName, style: theme.textTheme.titleSmall),
                    const SizedBox(height: 4),
                    LtrText(item.customerPhone),
                    const SizedBox(height: 4),
                    Text(formatJalaliDateTime(item.expectedAt)),
                    Text(formatClock(item.expectedAt)),
                    if (item.overdue)
                      Text(
                        AppStrings.agreedTimePast,
                        style: theme.textTheme.bodySmall,
                      ),
                    if (item.recordedBySupport)
                      Text(
                        AppStrings.recordedBySupport,
                        style: theme.textTheme.bodySmall,
                      ),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(
                        onPressed: () =>
                            ref.read(phoneLauncherProvider)(item.customerPhone),
                        icon: const Icon(Icons.call_outlined),
                        label: const Text(AppStrings.callCustomer),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        if (error != null)
          ErrorView(message: friendlyError(error!), onRetry: onRetry),
      ],
    );
  }
}
