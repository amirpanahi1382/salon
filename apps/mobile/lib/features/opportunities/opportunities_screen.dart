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

const _filterAll = 'ALL';
const _filterSalon = 'SALON_MESSAGES';
const _filterVip = 'VIP';
const _filterRevenueDrop = 'REVENUE_DROP';

class OpportunitiesScreen extends ConsumerStatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  ConsumerState<OpportunitiesScreen> createState() =>
      _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends ConsumerState<OpportunitiesScreen> {
  String _filter = _filterAll;
  List<OpportunityWorkspaceRow> _items = const [];
  String? _nextCursor;
  bool _hasMore = false;
  bool _loadingMore = false;
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
    });
    try {
      final page = await ref.read(opportunitiesRepositoryProvider).workspace(
            filter: _filter,
          );
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
        _vipEntitled = entitled;
        if (!entitled && _filter == _filterVip) {
          _filter = _filterAll;
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
    if (_loading || _loadingMore || !_hasMore || _nextCursor == null) {
      return;
    }
    setState(() => _loadingMore = true);
    try {
      final page = await ref.read(opportunitiesRepositoryProvider).workspace(
            filter: _filter,
            cursor: _nextCursor,
          );
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
  }

  void _selectFilter(String filter) {
    if (_filter == filter) {
      return;
    }
    setState(() => _filter = filter);
    _load();
  }

  Future<void> _openComposer(String customerId) async {
    await openOutreachMessageComposer(
      context: context,
      ref: ref,
      customerId: customerId,
    );
    if (mounted) {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final outreach = ref.watch(manualOutreachSelectionProvider);
    final openVip = ref.watch(vipSectionOpenProvider);
    if (outreach.focusOutreachTab) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) {
          return;
        }
        ref.read(manualOutreachSelectionProvider.notifier).consumeFocus();
      });
    }
    if (openVip) {
      return Scaffold(
        appBar: AppBar(
          title: const Text(AppStrings.vipSendMessage),
          leading: IconButton(
            icon: const Icon(Icons.close),
            onPressed: () {
              ref.read(vipSectionOpenProvider.notifier).setOpen(false);
            },
          ),
        ),
        body: const SalonVipSection(),
      );
    }

    final pending = [
      for (final item in outreach.inbox)
        if (!item.submitted) item,
    ];
    final selecting = outreach.selecting && _filter == _filterRevenueDrop;

    return Scaffold(
      appBar: AppBar(
        title: selecting
            ? Text(
                '${AppStrings.customerSelectionTitle} ${outreach.selectedCount} / ${ManualOutreachState.maxSelection}',
              )
            : const Text(AppStrings.opportunities),
        actions: [
          if (selecting)
            TextButton(
              onPressed: () =>
                  ref.read(manualOutreachSelectionProvider.notifier).exitSelection(),
              child: const Text(AppStrings.cancelSelection),
            )
          else if (_filter == _filterRevenueDrop)
            TextButton(
              onPressed: _items.isEmpty
                  ? null
                  : () => ref
                      .read(manualOutreachSelectionProvider.notifier)
                      .enterSelection(),
              child: const Text(AppStrings.selectMultipleCustomers),
            ),
        ],
      ),
      bottomNavigationBar: selecting
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: FilledButton(
                  onPressed: outreach.selectedCount == 0
                      ? null
                      : () {
                          ref
                              .read(manualOutreachSelectionProvider.notifier)
                              .confirmSelection();
                        },
                  child: const Text(AppStrings.sendMessageAction),
                ),
              ),
            )
          : null,
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
                  selected: _filter == _filterAll,
                  onSelected: () => _selectFilter(_filterAll),
                ),
                _TypeFilterChip(
                  label: AppStrings.sendMessageAction,
                  selected: _filter == _filterSalon,
                  onSelected: () => _selectFilter(_filterSalon),
                ),
                if (_vipEntitled)
                  _TypeFilterChip(
                    label: AppStrings.vipSendMessage,
                    selected: _filter == _filterVip,
                    onSelected: () => _selectFilter(_filterVip),
                  ),
                _TypeFilterChip(
                  label: AppStrings.revenueDecline,
                  selected: _filter == _filterRevenueDrop,
                  onSelected: () => _selectFilter(_filterRevenueDrop),
                ),
              ],
            ),
          ),
          if (outreach.limitMessage != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                outreach.limitMessage!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          Expanded(
            child: _loading
                ? const LoadingSkeleton(lines: 5)
                : _error != null
                ? ErrorView(message: friendlyError(_error!), onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: PagedNotificationListener(
                      hasMore: _hasMore,
                      loading: _loading || _loadingMore,
                      onLoadMore: _loadMore,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(
                          AppTokens.space16,
                          AppTokens.space8,
                          AppTokens.space16,
                          AppTokens.space32,
                        ),
                        children: [
                          if (pending.isNotEmpty) ...[
                            const SectionHeader(
                              AppStrings.workspacePendingSelectionTitle,
                            ),
                            for (final customer in pending)
                              _PendingComposerTile(
                                name: customer.fullName,
                                onCompose: () => _openComposer(customer.id),
                              ),
                            const SizedBox(height: AppTokens.space16),
                          ],
                          if (_items.isEmpty)
                            EmptyStateView(
                              title: switch (_filter) {
                                _filterSalon => AppStrings.workspaceEmptySalonTitle,
                                _filterVip => AppStrings.workspaceEmptyVipTitle,
                                _filterRevenueDrop =>
                                  AppStrings.workspaceEmptyRevenueDropTitle,
                                _ => AppStrings.workspaceEmptyAllTitle,
                              },
                              body: switch (_filter) {
                                _filterSalon => AppStrings.workspaceEmptySalonBody,
                                _filterVip => AppStrings.workspaceEmptyVipBody,
                                _filterRevenueDrop =>
                                  AppStrings.workspaceEmptyRevenueDropBody,
                                _ => AppStrings.workspaceEmptyAllBody,
                              },
                              icon: Icons.chat_bubble_outline,
                              compact: true,
                            )
                          else
                            for (final row in _items)
                              _WorkspaceRowTile(
                                row: row,
                                selecting: selecting,
                                selected: row.customerId != null &&
                                    outreach.isSelected(row.customerId!),
                                onToggle: () {
                                  if (row.customerId == null) {
                                    return;
                                  }
                                  final parts = row.displayName.split(' ');
                                  ref
                                      .read(manualOutreachSelectionProvider.notifier)
                                      .toggle(
                                        Customer(
                                          id: row.customerId!,
                                          firstName: parts.isEmpty
                                              ? row.displayName
                                              : parts.first,
                                          lastName: parts.length < 2
                                              ? ''
                                              : parts.sublist(1).join(' '),
                                          phoneNumber: row.phoneNumber ?? '',
                                          createdAt: DateTime.fromMillisecondsSinceEpoch(0),
                                          updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
                                        ),
                                      );
                                },
                                onOpenCustomer: row.customerId == null
                                    ? null
                                    : () => context.push(
                                          '/customers/${row.customerId}',
                                        ),
                              ),
                          if (_hasMore) PagedFooter(loading: _loadingMore),
                        ],
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _PendingComposerTile extends StatelessWidget {
  const _PendingComposerTile({
    required this.name,
    required this.onCompose,
  });

  final String name;
  final VoidCallback onCompose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(name, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTokens.space8),
          FilledButton(
            onPressed: onCompose,
            child: const Text(AppStrings.createSuitableMessage),
          ),
        ],
      ),
    );
  }
}

class _WorkspaceRowTile extends StatelessWidget {
  const _WorkspaceRowTile({
    required this.row,
    required this.selecting,
    required this.selected,
    required this.onToggle,
    this.onOpenCustomer,
  });

  final OpportunityWorkspaceRow row;
  final bool selecting;
  final bool selected;
  final VoidCallback onToggle;
  final VoidCallback? onOpenCustomer;

  @override
  Widget build(BuildContext context) {
    final status = workspaceMessageStateLabel(row.messageState);
    final subtitle = [
      if (row.isVip) AppStrings.workspaceVipBadge,
      if (status.isNotEmpty) status,
    ].join(' · ');

    if (selecting && row.customerId != null) {
      return CheckboxListTile(
        value: selected,
        onChanged: (_) => onToggle(),
        title: Text(row.displayName),
        contentPadding: EdgeInsets.zero,
      );
    }

    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(row.displayName),
      subtitle: subtitle.isEmpty ? null : Text(subtitle),
      onTap: onOpenCustomer,
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
