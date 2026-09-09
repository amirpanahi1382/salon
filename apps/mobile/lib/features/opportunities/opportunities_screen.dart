import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'opportunity_action_bar.dart';

class OpportunitiesScreen extends ConsumerStatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  ConsumerState<OpportunitiesScreen> createState() =>
      _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends ConsumerState<OpportunitiesScreen> {
  String? _type;
  List<Opportunity> _items = const [];
  List<OpportunityAction> _history = const [];
  Map<String, OpportunityAction> _openActions = const {};
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
      final page = await ref
          .read(intelligenceRepositoryProvider)
          .opportunities(type: _type);
      final history = await ref.read(actionRepositoryProvider).list();
      final openActions = await ref
          .read(actionRepositoryProvider)
          .list(status: 'OPEN');
      if (!mounted) {
        return;
      }
      setState(() {
        _items = page.items;
        _history = history.items;
        _openActions = {
          for (final action in openActions.items)
            opportunityActionKey(action.customerId, action.opportunityType):
                action,
        };
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
    return OpportunityActionsScope(
      onChanged: _load,
      child: Scaffold(
      appBar: AppBar(title: const Text(AppStrings.opportunities)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Wrap(
              spacing: 8,
              children: [
                ChoiceChip(
                  label: const Text(AppStrings.all),
                  selected: _type == null,
                  onSelected: (_) {
                    _type = null;
                    _load();
                  },
                ),
                ChoiceChip(
                  label: const Text(AppStrings.reactivation),
                  selected: _type == 'REACTIVATION',
                  onSelected: (_) {
                    _type = 'REACTIVATION';
                    _load();
                  },
                ),
                ChoiceChip(
                  label: const Text(AppStrings.customerReturn),
                  selected: _type == 'CUSTOMER_RETURN',
                  onSelected: (_) {
                    _type = 'CUSTOMER_RETURN';
                    _load();
                  },
                ),
                ChoiceChip(
                  label: const Text(AppStrings.revenueDecline),
                  selected: _type == 'REVENUE_DECLINE',
                  onSelected: (_) {
                    _type = 'REVENUE_DECLINE';
                    _load();
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingView()
                : _error != null
                ? ErrorView(message: friendlyError(_error!), onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: (_items.isEmpty ? 1 : _items.length) +
                                (_history.isEmpty ? 0 : _history.length + 1),
                            itemBuilder: (context, index) {
                              if (_items.isEmpty && index == 0) {
                                return const Padding(
                                  padding: EdgeInsets.only(bottom: 24),
                                  child: EmptyStateView(
                                    title: AppStrings.caughtUpTitle,
                                    body: AppStrings.caughtUpBody,
                                  ),
                                );
                              }
                              if (index < _items.length) {
                                final item = _items[index];
                                return Padding(
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
                                  ),
                                );
                              }
                              final historyStart = _items.isEmpty ? 1 : _items.length;
                              if (index == historyStart) {
                                return Padding(
                                  padding: const EdgeInsets.only(
                                    top: 8,
                                    bottom: 12,
                                  ),
                                  child: Text(
                                    AppStrings.actionHistory,
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium,
                                  ),
                                );
                              }
                              final action =
                                  _history[index - historyStart - 1];
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: ActionHistoryTile(action: action),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    ),
    );
  }
}
