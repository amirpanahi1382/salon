import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class OpportunitiesScreen extends ConsumerStatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  ConsumerState<OpportunitiesScreen> createState() =>
      _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends ConsumerState<OpportunitiesScreen> {
  String? _type;
  List<Opportunity> _items = const [];
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
      final items = await ref
          .read(intelligenceRepositoryProvider)
          .opportunities(type: _type);
      if (!mounted) {
        return;
      }
      setState(() {
        _items = items;
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
    return Scaffold(
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
                    child: _items.isEmpty
                        ? ListView(
                            children: const [
                              SizedBox(height: 80),
                              EmptyStateView(
                                title: AppStrings.caughtUpTitle,
                                body: AppStrings.caughtUpBody,
                              ),
                            ],
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: _items.length,
                            itemBuilder: (context, index) {
                              final item = _items[index];
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: OpportunityCard(
                                  name: item.fullName,
                                  status: item.status,
                                  type: item.type,
                                  reason: item.reason,
                                  action: item.recommendedAction,
                                  onTap: () => context.push(
                                    '/customers/${item.customerId}',
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}
