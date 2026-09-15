import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../outreach/manual_outreach_selection.dart';
import '../outreach/manual_outreach_state.dart';
import '../outreach/outreach_message_composer.dart';
import '../vip/salon_vip_section.dart';
import 'opportunity_action_bar.dart';

class OpportunitiesScreen extends ConsumerStatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  ConsumerState<OpportunitiesScreen> createState() =>
      _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends ConsumerState<OpportunitiesScreen> {
  String? _type;
  bool _outreach = false;
  bool _vip = false;
  List<Opportunity> _items = const [];
  String? _nextCursor;
  bool _hasMore = false;
  bool _loadingMore = false;
  List<OpportunityAction> _history = const [];
  String? _historyCursor;
  bool _historyHasMore = false;
  Map<String, OpportunityAction> _openActions = const {};
  String? _openActionsCursor;
  bool _openActionsHasMore = false;
  Object? _error;
  bool _loading = true;
  bool _vipEntitled = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _nextCursor = null;
      _hasMore = false;
      _historyCursor = null;
      _historyHasMore = false;
      _openActionsCursor = null;
      _openActionsHasMore = false;
    });
    try {
      final page = await ref
          .read(intelligenceRepositoryProvider)
          .opportunities(type: _type);
      final history = await ref.read(actionRepositoryProvider).list(status: 'COMPLETED');
      final openActions = await ref
          .read(actionRepositoryProvider)
          .list(status: 'OPEN');
      var entitled = false;
      try {
        entitled = (await ref.read(vipRepositoryProvider).capability()).entitled;
      } catch (_) {}
      if (!mounted) {
        return;
      }
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
        _history = history.items;
        _historyCursor = history.nextCursor;
        _historyHasMore = history.hasMore;
        _openActions = {
          for (final action in openActions.items)
            opportunityActionKey(action.customerId, action.opportunityType):
                action,
        };
        _openActionsCursor = openActions.nextCursor;
        _openActionsHasMore = openActions.hasMore;
        _vipEntitled = entitled;
        if (!entitled && _vip) {
          _vip = false;
        }
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
    if (_loading || _loadingMore) {
      return;
    }
    if (_hasMore && _nextCursor != null) {
      setState(() => _loadingMore = true);
      try {
        final page = await ref
            .read(intelligenceRepositoryProvider)
            .opportunities(type: _type, cursor: _nextCursor);
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
          _items = [..._items, ...page.items];
          _nextCursor = page.nextCursor;
          _hasMore = page.hasMore;
          _loadingMore = false;
        });
      } catch (_) {
        if (!mounted) {
          return;
        }
        setState(() => _loadingMore = false);
      }
      return;
    }
    if (_historyHasMore && _historyCursor != null) {
      setState(() => _loadingMore = true);
      try {
        final history = await ref
            .read(actionRepositoryProvider)
            .list(status: 'COMPLETED', cursor: _historyCursor);
        if (!mounted) {
          return;
        }
        setState(() {
          _history = [..._history, ...history.items];
          _historyCursor = history.nextCursor;
          _historyHasMore = history.hasMore;
          _loadingMore = false;
        });
      } catch (_) {
        if (!mounted) {
          return;
        }
        setState(() => _loadingMore = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final outreach = ref.watch(manualOutreachSelectionProvider);
    final openVip = ref.watch(vipSectionOpenProvider);
    if (outreach.focusOutreachTab && !_outreach) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) {
          return;
        }
        ref.read(manualOutreachSelectionProvider.notifier).consumeFocus();
        setState(() {
          _outreach = true;
          _vip = false;
          _type = null;
        });
      });
    }
    if (openVip && !_vip) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) {
          return;
        }
        ref.read(vipSectionOpenProvider.notifier).setOpen(false);
        setState(() {
          _vip = true;
          _outreach = false;
          _type = null;
        });
      });
    }
    return OpportunityActionsScope(
      onChanged: _load,
      child: Scaffold(
        appBar: AppBar(title: const Text(AppStrings.opportunities)),
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppTokens.space16,
                AppTokens.space8,
                AppTokens.space16,
                AppTokens.space4,
              ),
              child: Wrap(
                spacing: AppTokens.space8,
                runSpacing: AppTokens.space8,
                children: [
                  _TypeFilterChip(
                    label: AppStrings.all,
                    selected: !_outreach && !_vip && _type == null,
                    onSelected: () {
                      _outreach = false;
                      _vip = false;
                      _type = null;
                      _load();
                    },
                  ),
                  _TypeFilterChip(
                    label: AppStrings.sendMessageAction,
                    selected: _outreach,
                    onSelected: () {
                      setState(() {
                        _outreach = true;
                        _vip = false;
                        _type = null;
                      });
                    },
                  ),
                  if (_vipEntitled)
                    _TypeFilterChip(
                      label: AppStrings.vipSendMessage,
                      selected: _vip,
                      onSelected: () {
                        setState(() {
                          _vip = true;
                          _outreach = false;
                          _type = null;
                        });
                      },
                    ),
                  _TypeFilterChip(
                    label: AppStrings.reactivation,
                    selected: !_outreach && !_vip && _type == 'REACTIVATION',
                    onSelected: () {
                      _outreach = false;
                      _vip = false;
                      _type = 'REACTIVATION';
                      _load();
                    },
                  ),
                  _TypeFilterChip(
                    label: AppStrings.customerReturn,
                    selected: !_outreach && !_vip && _type == 'CUSTOMER_RETURN',
                    onSelected: () {
                      _outreach = false;
                      _vip = false;
                      _type = 'CUSTOMER_RETURN';
                      _load();
                    },
                  ),
                  _TypeFilterChip(
                    label: AppStrings.revenueDecline,
                    selected: !_outreach && !_vip && _type == 'REVENUE_DECLINE',
                    onSelected: () {
                      _outreach = false;
                      _vip = false;
                      _type = 'REVENUE_DECLINE';
                      _load();
                    },
                  ),
                ],
              ),
            ),
            Expanded(
              child: _vip
                  ? const SalonVipSection()
                  : _outreach
                  ? const _OutreachList()
                  : _loading
                  ? const LoadingSkeleton(lines: 5)
                  : _error != null
                  ? ErrorView(message: friendlyError(_error!), onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: PagedNotificationListener(
                        hasMore: _hasMore || _historyHasMore,
                        loading: _loading || _loadingMore,
                        onLoadMore: _loadMore,
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            final extra =
                                constraints.maxWidth > AppTokens.contentMaxWidth
                                    ? (constraints.maxWidth -
                                            AppTokens.contentMaxWidth) /
                                        2
                                    : AppTokens.space16;
                            final pad = extra.clamp(AppTokens.space16, 80.0);
                            return ListView.builder(
                              primary: true,
                              padding: EdgeInsets.fromLTRB(
                                pad,
                                AppTokens.space8,
                                pad,
                                AppTokens.space32,
                              ),
                              itemCount: (_items.isEmpty ? 1 : _items.length) +
                                  (_history.isEmpty ? 0 : _history.length + 1) +
                                  ((_hasMore || _historyHasMore) ? 1 : 0),
                              itemBuilder: (context, index) {
                                if (_items.isEmpty && index == 0) {
                                  return const Padding(
                                    padding: EdgeInsets.only(
                                      bottom: AppTokens.space24,
                                    ),
                                    child: EmptyStateView(
                                      title: AppStrings.caughtUpTitle,
                                      body: AppStrings.caughtUpBody,
                                      icon: Icons.check_circle_outline,
                                      compact: true,
                                    ),
                                  );
                                }
                                if (index < _items.length) {
                                  final item = _items[index];
                                  return OpportunityCard(
                                    emphasize: index == 0,
                                    name: item.fullName,
                                    status: item.status,
                                    type: item.type,
                                    reason: item.reason,
                                    action: item.recommendedAction,
                                    footer: OpportunityActionBar(
                                      layout: OpportunityActionLayout.stacked,
                                      customerId: item.customerId,
                                      opportunityType: item.type,
                                      customerName: item.fullName,
                                      openAction: _openActions[
                                          opportunityActionKey(
                                        item.customerId,
                                        item.type,
                                      )],
                                    ),
                                    onTap: () => context.push(
                                      '/customers/${item.customerId}',
                                    ),
                                  );
                                }
                                final historyStart =
                                    _items.isEmpty ? 1 : _items.length;
                                if (index == historyStart &&
                                    _history.isNotEmpty) {
                                  return const Padding(
                                    padding: EdgeInsets.only(
                                      top: AppTokens.space8,
                                      bottom: AppTokens.space8,
                                    ),
                                    child: SectionHeader(
                                      AppStrings.actionHistory,
                                    ),
                                  );
                                }
                                if (_history.isNotEmpty &&
                                    index > historyStart &&
                                    index <= historyStart + _history.length) {
                                  final action =
                                      _history[index - historyStart - 1];
                                  return Column(
                                    children: [
                                      ActionHistoryTile(action: action),
                                      const Divider(),
                                    ],
                                  );
                                }
                                return PagedFooter(loading: _loadingMore);
                              },
                            );
                          },
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OutreachList extends ConsumerStatefulWidget {
  const _OutreachList();

  @override
  ConsumerState<_OutreachList> createState() => _OutreachListState();
}

class _OutreachListState extends ConsumerState<_OutreachList> {
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  String? _nextCursor;
  bool _hasMore = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
      _nextCursor = null;
      _hasMore = false;
    });
    try {
      final page = await ref.read(messageRepositoryProvider).listManualOutreach();
      if (!mounted) {
        return;
      }
      ref.read(manualOutreachSelectionProvider.notifier).ingestRequested([
        for (final item in page.items)
          OutreachCustomerRef(
            id: item.customerId,
            fullName: item.customerName,
            messageRequestId: item.messageRequestId,
            status: item.status,
            requestedAt: item.requestedAt,
          ),
      ]);
      setState(() {
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
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
    if (_loading || _loadingMore || !_hasMore || _nextCursor == null) {
      return;
    }
    setState(() => _loadingMore = true);
    try {
      final page = await ref
          .read(messageRepositoryProvider)
          .listManualOutreach(cursor: _nextCursor);
      if (!mounted) {
        return;
      }
      final existing = ref.read(manualOutreachSelectionProvider).requested;
      final seen = {for (final item in existing) item.id};
      ref.read(manualOutreachSelectionProvider.notifier).ingestRequested([
        ...existing,
        for (final item in page.items)
          if (!seen.contains(item.customerId))
            OutreachCustomerRef(
              id: item.customerId,
              fullName: item.customerName,
              messageRequestId: item.messageRequestId,
              status: item.status,
              requestedAt: item.requestedAt,
            ),
      ]);
      setState(() {
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
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
    final items = ref.watch(manualOutreachSelectionProvider).inbox;
    if (_loading && items.isEmpty) {
      return const LoadingSkeleton(lines: 4);
    }
    if (_error != null && items.isEmpty) {
      return ErrorView(message: friendlyError(_error!), onRetry: _refresh);
    }
    if (items.isEmpty) {
      return const EmptyStateView(
        title: AppStrings.outreachEmptyTitle,
        body: AppStrings.outreachEmptyBody,
        icon: Icons.chat_bubble_outline,
        compact: true,
      );
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: PagedNotificationListener(
        hasMore: _hasMore,
        loading: _loading || _loadingMore,
        onLoadMore: _loadMore,
        child: ListView.separated(
          padding: const EdgeInsets.fromLTRB(
            AppTokens.space16,
            AppTokens.space8,
            AppTokens.space16,
            AppTokens.space32,
          ),
          itemCount: items.length + (_hasMore ? 1 : 0),
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index >= items.length) {
              return PagedFooter(loading: _loadingMore);
            }
            final customer = items[index];
            final submitted = customer.submitted;
            return IgnorePointer(
              ignoring: submitted,
              child: Opacity(
                opacity: submitted ? 0.72 : 1,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: AppTokens.space8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        customer.fullName,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              color: submitted ? AppTokens.textSecondary : null,
                            ),
                      ),
                      const SizedBox(height: AppTokens.space8),
                      if (submitted)
                        Text(
                          outreachLifecycleLabel(customer.status ?? 'QUEUED'),
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: AppTokens.textSecondary,
                              ),
                        )
                      else
                        FilledButton(
                          onPressed: () => openOutreachMessageComposer(
                            context: context,
                            ref: ref,
                            customerId: customer.id,
                          ),
                          child: const Text(AppStrings.createSuitableMessage),
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _TypeFilterChip extends StatelessWidget {
  const _TypeFilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onSelected(),
      showCheckmark: false,
      labelPadding: const EdgeInsets.symmetric(horizontal: AppTokens.space8),
      visualDensity: VisualDensity.comfortable,
    );
  }
}
