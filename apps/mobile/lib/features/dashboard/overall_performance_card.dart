import 'package:flutter/material.dart';

import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class OverallPerformanceCard extends StatelessWidget {
  const OverallPerformanceCard({super.key, required this.performance});

  final SalonOverallPerformance performance;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final metrics = [
      (
        AppStrings.metricSalonCustomers,
        performance.customerCount,
      ),
      (
        AppStrings.metricSalonCustomerSentMessages,
        performance.salonCustomerSentMessageCount,
      ),
      (
        AppStrings.metricVipSentMessages,
        performance.vipSentMessageCount,
      ),
      (
        AppStrings.metricAgreedReturns,
        performance.agreedReturnCount,
      ),
      (
        AppStrings.metricMessageAssociatedReturns,
        performance.messageAssociatedReturnedCustomerCount,
      ),
      (
        AppStrings.metricReturningSalonCustomers,
        performance.returningSalonCustomerCount,
      ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(AppStrings.overallPerformanceTitle, style: theme.textTheme.titleMedium),
        const SizedBox(height: AppTokens.space16),
        for (var i = 0; i < metrics.length; i += 2) ...[
          if (i > 0) const SizedBox(height: AppTokens.space16),
          MetricRow(
            evenColumns: true,
            children: [
              MetricWidget(
                label: metrics[i].$1,
                value: toPersianDigits(metrics[i].$2.toString()),
                size: MetricSize.compact,
              ),
              MetricWidget(
                label: metrics[i + 1].$1,
                value: toPersianDigits(metrics[i + 1].$2.toString()),
                size: MetricSize.compact,
              ),
            ],
          ),
        ],
      ],
    );
  }
}
