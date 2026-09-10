import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
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
  String? _opportunitiesCursor;
  bool _opportunitiesHasMore = false;
  bool _loadingMore = false;
  Map<String, OpportunityAction> _openActions = const {};
  String? _openActionsCursor;
  bool _openActionsHasMore = false;
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
        _opportunitiesCursor = opportunities.nextCursor;
        _opportunitiesHasMore = opportunities.hasMore;
        _openActions = {
          for (final action in openActions.items)
            opportunityActionKey(action.customerId, action.opportunityType):
                action,
        };
        _openActionsCursor = openActions.nextCursor;
        _openActionsHasMore = openActions.hasMore;
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

  Future<void> _loadMore() async {
    if (_loading || _loadingMore || !_opportunitiesHasMore || _opportunitiesCursor == null) {
      return;
    }
    setState(() => _loadingMore = true);
    try {
      final page = await ref
          .read(intelligenceRepositoryProvider)
          .opportunities(cursor: _opportunitiesCursor);
      if (_openActionsHasMore && _openActionsCursor != null) {
        final open = await ref
            .read(actionRepositoryProvider)
            .list(status: 'OPEN', cursor: _openActionsCursor);
        _openActions = {
          ..._openActions,
          for (final action in open.items)
            opportunityActionKey(action.customerId, action.opportunityType):
                action,
        };
        _openActionsCursor = open.nextCursor;
        _openActionsHasMore = open.hasMore;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _opportunities = [..._opportunities, ...page.items];
        _opportunitiesCursor = page.nextCursor;
        _opportunitiesHasMore = page.hasMore;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).user;
    if (_loading && _summary == null) {
      return const Scaffold(body: LoadingSkeleton(lines: 4));
    }
    if (_error != null && _summary == null) {
      return Scaffold(
        body: ErrorView(message: friendlyError(_error!), onRetry: _load),
      );
    }
    final summary = _summary!;
    final theme = Theme.of(context);
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
                  style: theme.textTheme.bodySmall,
                ),
            ],
          ),
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: PagedNotificationListener(
            hasMore: _opportunitiesHasMore,
            loading: _loading || _loadingMore,
            onLoadMore: _loadMore,
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
                    Text(
                      AppStrings.attentionQuestion,
                      style: theme.textTheme.displaySmall,
                    ),
                    const SizedBox(height: AppTokens.space20),
                    InsightHero(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          MetricWidget(
                            label: AppStrings.metricAtRisk,
                            value: toPersianDigits(summary.atRisk.toString()),
                            size: MetricSize.hero,
                          ),
                          const SizedBox(height: AppTokens.space20),
                          MetricRow(
                            children: [
                              MetricWidget(
                                label: AppStrings.metricInactive,
                                value: toPersianDigits(
                                  summary.inactive.toString(),
                                ),
                                size: MetricSize.compact,
                              ),
                              MetricWidget(
                                label: AppStrings.metricReactivation,
                                value: toPersianDigits(
                                  summary.reactivationOpportunities.toString(),
                                ),
                                size: MetricSize.compact,
                              ),
                              MetricWidget(
                                label: AppStrings.customerReturn,
                                value: toPersianDigits(
                                  summary.customerReturnOpportunities
                                      .toString(),
                                ),
                                size: MetricSize.compact,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppTokens.space32),
                    const SectionHeader(AppStrings.metricRevenueThisMonth),
                    MetricWidget(
                      label: AppStrings.rial,
                      value: summary.revenueThisUtcMonth,
                      valueDirection: TextDirection.ltr,
                      size: MetricSize.standard,
                    ),
                    const SizedBox(height: AppTokens.space8),
                    Text(
                      AppStrings.metricCompletedRevenue,
                      style: theme.textTheme.bodySmall,
                    ),
                    LtrText(
                      '${summary.totalRevenue} ${AppStrings.rial}',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: AppTokens.space8),
                    Text(
                      AppStrings.revenueUtcNote,
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: AppTokens.space32),
                    Wrap(
                      spacing: AppTokens.space24,
                      runSpacing: AppTokens.space12,
                      children: [
                        _QuietMetric(
                          label: AppStrings.metricTotalCustomers,
                          value: summary.customers,
                        ),
                        _QuietMetric(
                          label: AppStrings.metricActive,
                          value: summary.active,
                        ),
                        _QuietMetric(
                          label: AppStrings.metricNew,
                          value: summary.newCustomers,
                        ),
                        _QuietMetric(
                          label: statusLabel('RETURNING'),
                          value: summary.returning,
                        ),
                        _QuietMetric(
                          label: signalLabel('FREQUENT'),
                          value: summary.frequent,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppTokens.space32),
                    const SectionHeader(AppStrings.customersNeedingAttention),
                    if (_opportunities.isEmpty)
                      const EmptyStateView(
                        title: AppStrings.caughtUpTitle,
                        body: AppStrings.caughtUpBody,
                        icon: Icons.check_circle_outline,
                      )
                    else
                      ..._opportunities.map(
                        (item) => Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppTokens.space16,
                          ),
                          child: OpportunityPreview(
                            name: item.fullName,
                            status: item.status,
                            type: item.type,
                            reason: item.reason,
                            action: item.recommendedAction,
                            footer: OpportunityActionBar(
                              customerId: item.customerId,
                              opportunityType: item.type,
                              customerName: item.fullName,
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
                    if (_opportunitiesHasMore)
                      PagedFooter(loading: _loadingMore),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _QuietMetric extends StatelessWidget {
  const _QuietMetric({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Text(
      '${toPersianDigits(value.toString())} $label',
      style: Theme.of(context).textTheme.bodySmall,
    );
  }
}
