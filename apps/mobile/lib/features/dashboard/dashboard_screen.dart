import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../opportunities/opportunity_action_bar.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  IntelligenceSummary? _summary;
  List<Opportunity> _opportunities = const [];
  Map<String, OpportunityAction> _openActions = const {};
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
      final summary = await ref.read(intelligenceRepositoryProvider).summary();
      final opportunities = await ref
          .read(intelligenceRepositoryProvider)
          .opportunities();
      final openActions = await ref
          .read(actionRepositoryProvider)
          .list(status: 'OPEN');
      final salon = await ref.read(salonRepositoryProvider).current();
      if (!mounted) {
        return;
      }
      setState(() {
        _summary = summary;
        _opportunities = opportunities.items;
        _openActions = {
          for (final action in openActions.items)
            opportunityActionKey(action.customerId, action.opportunityType):
                action,
        };
        _salon = salon;
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
    if (_loading && _summary == null) {
      return const Scaffold(body: LoadingView());
    }
    if (_error != null && _summary == null) {
      return Scaffold(
        body: ErrorView(message: friendlyError(_error!), onRetry: _load),
      );
    }
    final summary = _summary!;
    return OpportunityActionsScope(
      onChanged: _load,
      child: Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_salon?.name ?? AppStrings.appName),
            if (user?.name != null)
              Text(
                user!.name!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              AppStrings.attentionQuestion,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            LayoutBuilder(
              builder: (context, constraints) {
                final cardWidth = (constraints.maxWidth - 12) / 2;
                Widget metric(String label, int value) {
                  return SizedBox(
                    width: cardWidth,
                    child: MetricCard(
                      label: label,
                      value: toPersianDigits(value.toString()),
                    ),
                  );
                }

                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    metric(AppStrings.metricTotalCustomers, summary.customers),
                    metric(AppStrings.metricActive, summary.active),
                    metric(AppStrings.metricAtRisk, summary.atRisk),
                    metric(AppStrings.metricInactive, summary.inactive),
                    metric(
                      AppStrings.metricReactivation,
                      summary.reactivationOpportunities,
                    ),
                    metric(AppStrings.metricNew, summary.newCustomers),
                    SizedBox(
                      width: cardWidth,
                      child: MetricCard(
                        label: AppStrings.metricRevenueThisMonth,
                        value:
                            '${summary.revenueThisUtcMonth} ${AppStrings.rial}',
                        valueDirection: TextDirection.ltr,
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: MetricCard(
                        label: AppStrings.metricCompletedRevenue,
                        value: '${summary.totalRevenue} ${AppStrings.rial}',
                        valueDirection: TextDirection.ltr,
                      ),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 24),
            Text(
              AppStrings.customersNeedingAttention,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            if (_opportunities.isEmpty)
              const EmptyStateView(
                title: AppStrings.caughtUpTitle,
                body: AppStrings.caughtUpBody,
              )
            else
              ..._opportunities
                  .take(8)
                  .map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: OpportunityCard(
                        name: item.fullName,
                        status: item.status,
                        type: item.type,
                        reason: item.reason,
                        action: item.recommendedAction,
                        footer: OpportunityActionBar(
                          customerId: item.customerId,
                          opportunityType: item.type,
                          openAction: _openActions[opportunityActionKey(
                            item.customerId,
                            item.type,
                          )],
                        ),
                        onTap: () =>
                            context.push('/customers/${item.customerId}'),
                      ),
                    ),
                  ),
          ],
        ),
      ),
    ),
    );
  }
}
