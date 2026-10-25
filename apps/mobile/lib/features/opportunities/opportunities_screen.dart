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

enum _OpportunitiesSection { revenueDrop, vip, ordinary }

class OpportunitiesScreen extends ConsumerStatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  ConsumerState<OpportunitiesScreen> createState() =>
      _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends ConsumerState<OpportunitiesScreen> {
  _OpportunitiesSection _section = _OpportunitiesSection.revenueDrop;

  List<RevenueDropItem> _revenueItems = const [];
  String? _revenueCursor;
  bool _revenueHasMore = false;
  DateTime? _revenueAsOf;

  List<VipRequestHistoryItem> _vipItems = const [];
  String? _vipCursor;
  bool _vipHasMore = false;
  bool _vipEntitled = false;

  List<OrdinaryMessageHistoryItem> _ordinaryItems = const [];
  String? _ordinaryCursor;
  bool _ordinaryHasMore = false;

  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;

  /// Bumped on every section change, refresh, and VIP-screen return so late
  /// responses from another section cannot overwrite state.
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  bool _isCurrentLoad(int generation, _OpportunitiesSection section) {
    return mounted && _loadGeneration == generation && _section == section;
  }

  Future<void> _load() async {
    final generation = ++_loadGeneration;
    final section = _section;
    setState(() {
      _loading = true;
      _error = null;
      _loadingMore = false;
      switch (section) {
        case _OpportunitiesSection.revenueDrop:
          _revenueCursor = null;
          _revenueHasMore = false;
        case _OpportunitiesSection.vip:
          _vipCursor = null;
          _vipHasMore = false;
        case _OpportunitiesSection.ordinary:
          _ordinaryCursor = null;
          _ordinaryHasMore = false;
      }
    });
    try {
      switch (section) {
        case _OpportunitiesSection.revenueDrop:
          final page =
              await ref.read(intelligenceRepositoryProvider).revenueDrops();
          if (!_isCurrentLoad(generation, section)) return;
          setState(() {
            _revenueItems = page.items;
            _revenueCursor = page.nextCursor;
            _revenueHasMore = page.hasMore;
            _revenueAsOf = page.asOf;
            _loading = false;
          });
        case _OpportunitiesSection.vip:
          final page = await ref.read(vipRepositoryProvider).requestHistory();
          if (!_isCurrentLoad(generation, section)) return;
          setState(() {
            _vipEntitled = page.entitled;
            _vipItems = page.items;
            _vipCursor = page.nextCursor;
            _vipHasMore = page.hasMore;
            _loading = false;
          });
        case _OpportunitiesSection.ordinary:
          final page =
              await ref.read(messageRepositoryProvider).listOrdinaryHistory();
          if (!_isCurrentLoad(generation, section)) return;
          setState(() {
            _ordinaryItems = page.items;
            _ordinaryCursor = page.nextCursor;
            _ordinaryHasMore = page.hasMore;
            _loading = false;
          });
      }
    } catch (error) {
      if (!_isCurrentLoad(generation, section)) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loading || _loadingMore) return;
    final generation = _loadGeneration;
    final section = _section;
    setState(() => _loadingMore = true);
    try {
      switch (section) {
        case _OpportunitiesSection.revenueDrop:
          if (!_revenueHasMore || _revenueCursor == null) {
            if (_isCurrentLoad(generation, section)) {
              setState(() => _loadingMore = false);
            }
            return;
          }
          final cursor = _revenueCursor;
          final page = await ref
              .read(intelligenceRepositoryProvider)
              .revenueDrops(cursor: cursor);
          if (!_isCurrentLoad(generation, section)) return;
          setState(() {
            _revenueItems = [..._revenueItems, ...page.items];
            _revenueCursor = page.nextCursor;
            _revenueHasMore = page.hasMore;
            _loadingMore = false;
          });
        case _OpportunitiesSection.vip:
          if (!_vipHasMore || _vipCursor == null) {
            if (_isCurrentLoad(generation, section)) {
              setState(() => _loadingMore = false);
            }
            return;
          }
          final cursor = _vipCursor;
          final page = await ref
              .read(vipRepositoryProvider)
              .requestHistory(cursor: cursor);
          if (!_isCurrentLoad(generation, section)) return;
          setState(() {
            _vipItems = [..._vipItems, ...page.items];
            _vipCursor = page.nextCursor;
            _vipHasMore = page.hasMore;
            _loadingMore = false;
          });
        case _OpportunitiesSection.ordinary:
          if (!_ordinaryHasMore || _ordinaryCursor == null) {
            if (_isCurrentLoad(generation, section)) {
              setState(() => _loadingMore = false);
            }
            return;
          }
          final cursor = _ordinaryCursor;
          final page = await ref
              .read(messageRepositoryProvider)
              .listOrdinaryHistory(cursor: cursor);
          if (!_isCurrentLoad(generation, section)) return;
          setState(() {
            _ordinaryItems = [..._ordinaryItems, ...page.items];
            _ordinaryCursor = page.nextCursor;
            _ordinaryHasMore = page.hasMore;
            _loadingMore = false;
          });
      }
    } catch (_) {
      if (!_isCurrentLoad(generation, section)) return;
      setState(() => _loadingMore = false);
    }
  }

  void _selectSection(_OpportunitiesSection section) {
    if (_section == section) return;
    setState(() => _section = section);
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

  bool get _hasMore => switch (_section) {
        _OpportunitiesSection.revenueDrop => _revenueHasMore,
        _OpportunitiesSection.vip => _vipHasMore,
        _OpportunitiesSection.ordinary => _ordinaryHasMore,
      };

  @override
  Widget build(BuildContext context) {
    final outreach = ref.watch(manualOutreachSelectionProvider);
    final openVip = ref.watch(vipSectionOpenProvider);
    if (outreach.focusOutreachTab) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(manualOutreachSelectionProvider.notifier).consumeFocus();
        _selectSection(_OpportunitiesSection.ordinary);
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
              _load();
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
    final selecting =
        outreach.selecting && _section == _OpportunitiesSection.revenueDrop;

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
          else if (_section == _OpportunitiesSection.revenueDrop)
            TextButton(
              onPressed: _revenueItems.isEmpty
                  ? null
                  : () => ref
                      .read(manualOutreachSelectionProvider.notifier)
                      .enterSelection(),
              child: const Text(AppStrings.selectMultipleCustomers),
            )
          else if (_section == _OpportunitiesSection.vip && _vipEntitled)
            TextButton(
              onPressed: () =>
                  ref.read(vipSectionOpenProvider.notifier).setOpen(true),
              child: const Text(AppStrings.vipSendMessage),
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
                _SectionChip(
                  label: AppStrings.opportunitiesSectionRevenueDrop,
                  selected: _section == _OpportunitiesSection.revenueDrop,
                  onSelected: () =>
                      _selectSection(_OpportunitiesSection.revenueDrop),
                ),
                _SectionChip(
                  label: AppStrings.opportunitiesSectionVip,
                  selected: _section == _OpportunitiesSection.vip,
                  onSelected: () => _selectSection(_OpportunitiesSection.vip),
                ),
                _SectionChip(
                  label: AppStrings.opportunitiesSectionOrdinary,
                  selected: _section == _OpportunitiesSection.ordinary,
                  onSelected: () =>
                      _selectSection(_OpportunitiesSection.ordinary),
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
                              if (pending.isNotEmpty &&
                                  (_section ==
                                          _OpportunitiesSection.revenueDrop ||
                                      _section ==
                                          _OpportunitiesSection.ordinary)) ...[
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
                              ..._sectionBody(context, selecting, outreach),
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

  List<Widget> _sectionBody(
    BuildContext context,
    bool selecting,
    ManualOutreachState outreach,
  ) {
    switch (_section) {
      case _OpportunitiesSection.revenueDrop:
        if (_revenueItems.isEmpty) {
          return const [
            EmptyStateView(
              title: AppStrings.workspaceEmptyRevenueDropTitle,
              body: '',
              icon: Icons.trending_down,
              compact: true,
            ),
          ];
        }
        return [
          Padding(
            padding: const EdgeInsets.only(bottom: AppTokens.space12),
            child: Text(
              AppStrings.revenueDropSalonExplanation,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          if (_revenueAsOf != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space8),
              child: Text(
                'به‌روز تا ${_revenueAsOf!.toLocal()}',
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
          for (final item in _revenueItems)
            _RevenueDropTile(
              item: item,
              selecting: selecting,
              selected: outreach.isSelected(item.customerId),
              onToggle: () {
                ref.read(manualOutreachSelectionProvider.notifier).toggle(
                      Customer(
                        id: item.customerId,
                        firstName: item.firstName,
                        lastName: item.lastName,
                        phoneNumber: item.phoneNumber,
                        createdAt: DateTime.fromMillisecondsSinceEpoch(0),
                        updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
                      ),
                    );
              },
              onOpen: () => context.push('/customers/${item.customerId}'),
              onCompose: () => _openComposer(item.customerId),
            ),
        ];
      case _OpportunitiesSection.vip:
        if (_vipItems.isEmpty) {
          return [
            EmptyStateView(
              title: AppStrings.workspaceEmptyVipTitle,
              body: _vipEntitled ? '' : AppStrings.vipNewRequestRequiresAdmin,
              icon: _vipEntitled ? Icons.star_outline : Icons.lock_outline,
              compact: true,
            ),
          ];
        }
        return [
          if (!_vipEntitled)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space8),
              child: Text(
                AppStrings.vipNewRequestRequiresAdmin,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          for (final item in _vipItems) _VipHistoryTile(item: item),
        ];
      case _OpportunitiesSection.ordinary:
        if (_ordinaryItems.isEmpty) {
          return const [
            EmptyStateView(
              title: AppStrings.workspaceEmptySalonTitle,
              body: AppStrings.workspaceEmptySalonBody,
              icon: Icons.chat_bubble_outline,
              compact: true,
            ),
          ];
        }
        return [
          for (final item in _ordinaryItems)
            _OrdinaryMessageTile(
              item: item,
              onOpen: () => context.push('/customers/${item.customerId}'),
            ),
        ];
    }
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

class _RevenueDropTile extends StatelessWidget {
  const _RevenueDropTile({
    required this.item,
    required this.selecting,
    required this.selected,
    required this.onToggle,
    required this.onOpen,
    required this.onCompose,
  });

  final RevenueDropItem item;
  final bool selecting;
  final bool selected;
  final VoidCallback onToggle;
  final VoidCallback onOpen;
  final VoidCallback onCompose;

  @override
  Widget build(BuildContext context) {
    final amounts = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(item.fullName, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          '${AppStrings.revenueDropPreviousLabel}: ${item.previousComparableAmount} ${item.currency}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        Text(
          '${AppStrings.revenueDropCurrentLabel}: ${item.currentAmount} ${item.currency}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        Text(
          '${AppStrings.revenueDropDifferenceLabel}: ${item.differenceAmount} ${item.currency}',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ],
    );

    if (selecting) {
      return CheckboxListTile(
        value: selected,
        onChanged: (_) => onToggle(),
        title: amounts,
        contentPadding: EdgeInsets.zero,
      );
    }

    return Card(
      margin: const EdgeInsets.only(bottom: AppTokens.space12),
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(onTap: onOpen, child: amounts),
            const SizedBox(height: AppTokens.space8),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                onPressed: onCompose,
                child: const Text(AppStrings.createSuitableMessage),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VipHistoryTile extends StatelessWidget {
  const _VipHistoryTile({required this.item});

  final VipRequestHistoryItem item;

  @override
  Widget build(BuildContext context) {
    final request = item.request;
    final progress = request.progress;
    return Card(
      margin: const EdgeInsets.only(bottom: AppTokens.space12),
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              request.listName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'شناسه: ${request.id}',
              style: Theme.of(context).textTheme.labelSmall,
            ),
            Text(
              '${request.requestedCount} مخاطب · ${request.status}'
              '${request.createdAt != null ? ' · ${request.createdAt!.toLocal()}' : ''}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (progress != null) ...[
              const SizedBox(height: 8),
              Text(progress.headline),
              Text(
                progress.explanation,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 8),
            Text(
              '${AppStrings.vipHistoryRecordedSends}: ${item.recordedSendCount}'
              '${item.manualRecordedSendCount > 0 ? ' (دستی: ${item.manualRecordedSendCount})' : ''}',
            ),
            Text(
              '${AppStrings.vipHistoryInProgress}: ${item.stillQueuedOrInProgressCount}',
            ),
            if (!item.metricsAvailable)
              const Text(AppStrings.vipHistoryMetricsUnavailable)
            else ...[
              Text(
                '${AppStrings.vipHistoryIntentions}: ${item.intentionRecipientCount ?? 0}'
                '${item.recipientDenominator != null ? ' / ${item.recipientDenominator}' : ''}',
              ),
              Text(
                '${AppStrings.vipHistoryVisited}: ${item.visitedRecipientCount ?? 0}'
                '${item.recipientDenominator != null ? ' / ${item.recipientDenominator}' : ''}',
              ),
            ],
            if (progress != null)
              for (final line in progress.countLines)
                Text('${line.label}: ${line.count}'),
          ],
        ),
      ),
    );
  }
}

class _OrdinaryMessageTile extends StatelessWidget {
  const _OrdinaryMessageTile({
    required this.item,
    required this.onOpen,
  });

  final OrdinaryMessageHistoryItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final status = switch (item.displayStatus) {
      'PROCESSING' => AppStrings.ordinaryMessageStatusProcessing,
      'SENT' => AppStrings.ordinaryMessageStatusSent,
      'FAILED' => AppStrings.ordinaryMessageStatusFailed,
      'CANCELLED' => AppStrings.ordinaryMessageStatusCancelled,
      _ => AppStrings.ordinaryMessageStatusQueued,
    };
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(item.customerDisplayName),
      subtitle: Text(
        '$status · ${item.destinationHint}\n${item.requestedAt.toLocal()}',
      ),
      isThreeLine: true,
      onTap: onOpen,
    );
  }
}

class _SectionChip extends StatelessWidget {
  const _SectionChip({
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
