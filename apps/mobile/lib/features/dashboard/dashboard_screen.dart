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
                    InsightHero(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            AppStrings.attentionQuestion,
                            style: theme.textTheme.displaySmall?.copyWith(
                              fontSize: 22,
                              height: 1.4,
                            ),
                          ),
                          const SizedBox(height: AppTokens.space8),
                          MetricWidget(
                            label: AppStrings.metricAtRisk,
                            value: toPersianDigits(summary.atRisk.toString()),
                            size: MetricSize.hero,
                            emphasize: true,
                          ),
                          const SizedBox(height: AppTokens.space8),
                          const Divider(),
                          const SizedBox(height: AppTokens.space8),
                          MetricRow(
                            evenColumns: true,
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
                    const SizedBox(height: AppTokens.space24),
                    _RevenueBlock(
                      monthAmount: summary.revenueThisUtcMonth,
                      completedAmount: summary.totalRevenue,
                    ),
                    const SizedBox(height: AppTokens.space24),
                    const SectionHeader(AppStrings.customerStatusHeading),
                    _CustomerStatusRow(summary: summary),
                    const SizedBox(height: AppTokens.space24),
                    const SectionHeader(AppStrings.customersNeedingAttention),
                    if (_opportunities.isEmpty)
                      const EmptyStateView(
                        title: AppStrings.caughtUpTitle,
                        body: AppStrings.caughtUpBody,
                        icon: Icons.check_circle_outline,
                        compact: true,
                      )
                    else
                      ...[
                        for (var i = 0; i < _opportunities.length; i++) ...[
                          if (i > 0) const Divider(),
                          OpportunityPreview(
                            framed: false,
                            name: _opportunities[i].fullName,
                            status: _opportunities[i].status,
                            type: _opportunities[i].type,
                            reason: _opportunities[i].reason,
                            action: _opportunities[i].recommendedAction,
                            footer: OpportunityActionBar(
                              customerId: _opportunities[i].customerId,
                              opportunityType: _opportunities[i].type,
                              customerName: _opportunities[i].fullName,
                              openAction: _openActions[opportunityActionKey(
                                _opportunities[i].customerId,
                                _opportunities[i].type,
                              )],
                            ),
                            onTap: () => context.push(
                              '/customers/${_opportunities[i].customerId}',
                            ),
                          ),
                        ],
                      ],
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

class _RevenueBlock extends StatelessWidget {
  const _RevenueBlock({
    required this.monthAmount,
    required this.completedAmount,
  });

  final String monthAmount;
  final String completedAmount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label:
          '${AppStrings.metricRevenueThisMonth} $monthAmount ${AppStrings.rial}. ${AppStrings.metricCompletedRevenue} $completedAmount',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            AppStrings.metricRevenueThisMonth,
            padding: EdgeInsets.only(bottom: AppTokens.space8),
          ),
          LtrText(
            monthAmount,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontSize: 28,
              height: 1.15,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: AppTokens.space4),
          Text(AppStrings.rial, style: theme.textTheme.bodySmall),
          const SizedBox(height: AppTokens.space12),
          Text(
            AppStrings.metricCompletedRevenue,
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: AppTokens.space4),
          LtrText(completedAmount, style: theme.textTheme.titleSmall),
        ],
      ),
    );
  }
}

class _CustomerStatusRow extends StatelessWidget {
  const _CustomerStatusRow({required this.summary});

  final IntelligenceSummary summary;

  @override
  Widget build(BuildContext context) {
    final stats = [
      QuietStat(
        label: AppStrings.metricTotalCustomers,
        value: toPersianDigits(summary.customers.toString()),
      ),
      QuietStat(
        label: AppStrings.metricActive,
        value: toPersianDigits(summary.active.toString()),
      ),
      QuietStat(
        label: AppStrings.metricNew,
        value: toPersianDigits(summary.newCustomers.toString()),
      ),
      QuietStat(
        label: statusLabel('RETURNING'),
        value: toPersianDigits(summary.returning.toString()),
      ),
      QuietStat(
        label: signalLabel('FREQUENT'),
        value: toPersianDigits(summary.frequent.toString()),
      ),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 560
            ? 5
            : constraints.maxWidth >= 360
                ? 3
                : 2;
        final gap = AppTokens.space12;
        final width =
            (constraints.maxWidth - gap * (columns - 1)) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: AppTokens.space16,
          children: [
            for (final stat in stats) SizedBox(width: width, child: stat),
          ],
        );
      },
    );
  }
}
