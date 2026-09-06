import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  IntelligenceSummary? _summary;
  List<Opportunity> _opportunities = const [];
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
      final salon = await ref.read(salonRepositoryProvider).current();
      if (!mounted) {
        return;
      }
      setState(() {
        _summary = summary;
        _opportunities = opportunities.items;
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
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_salon?.name ?? AppStrings.appName),
            if (user?.name != null)
              Text(user!.name!, style: Theme.of(context).textTheme.bodySmall),
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
                    child: MetricCard(label: label, value: value),
                  );
                }

                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    metric('Total customers', summary.customers),
                    metric('Active', summary.active),
                    metric('At risk', summary.atRisk),
                    metric('Inactive', summary.inactive),
                    metric('Reactivation', summary.reactivationOpportunities),
                    metric('New', summary.newCustomers),
                  ],
                );
              },
            ),
            const SizedBox(height: 24),
            Text(
              'Customers needing attention',
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
                        onTap: () =>
                            context.push('/customers/${item.customerId}'),
                      ),
                    ),
                  ),
          ],
        ),
      ),
    );
  }
}
