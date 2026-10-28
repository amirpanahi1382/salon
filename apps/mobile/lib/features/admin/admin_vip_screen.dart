import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/cursor_page_state.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../../shared/platform/excel_file_saver.dart';
import '../../shared/vip_regions.dart';
import 'admin_messaging_shell.dart';

class AdminVipScreen extends ConsumerStatefulWidget {
  const AdminVipScreen({super.key});

  @override
  ConsumerState<AdminVipScreen> createState() => _AdminVipScreenState();
}

class _AdminVipScreenState extends ConsumerState<AdminVipScreen> {
  late final CursorPageState<VipTargetList> _lists = CursorPageState(
    keyOf: (list) => list.id,
    changed: () {
      if (mounted) setState(() {});
    },
  );
  int _listGeneration = 0;
  int? _listCount;
  int? _contactRowCount;
  int? _recordedContactCount;

  @override
  void initState() {
    super.initState();
    _loadLists();
  }

  Future<void> _loadLists({bool reset = false}) async {
    if (reset) {
      _listGeneration++;
      _listCount = null;
      _contactRowCount = null;
      _recordedContactCount = null;
      _lists.reset();
    }
    final generation = _listGeneration;
    await _lists.load((cursor) async {
      final page = await ref.read(vipRepositoryProvider).adminLists(cursor: cursor);
      if (generation == _listGeneration && cursor == null) {
        _listCount = page.listCount;
        _contactRowCount = page.contactRowCount;
        _recordedContactCount = page.recordedContactCount;
      }
      return page;
    });
  }

  Future<void> _loadMoreLists() => _loadLists();

  Future<void> _refresh() => _loadLists(reset: true);

  Future<void> _import() async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['xlsx'],
    );
    if (file == null) {
      return;
    }
    final bytes = await file.readAsBytes();
    VipTargetList imported;
    try {
      imported = await ref
          .read(vipRepositoryProvider)
          .importList(bytes, file.name, createRequestId());
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(error))));
      return;
    }
    if (!mounted) return;
    await _loadLists(reset: true);
    if (!mounted) return;
    await context.push('/admin/vip/${imported.id}');
    if (!mounted) return;
    await _loadLists(reset: true);
  }

  Future<void> _open(VipTargetList item) async {
    await context.push('/admin/vip/${item.id}');
    if (!mounted) return;
    await _loadLists(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: const Text(AppStrings.adminVipLists),
          leading: IconButton(
            onPressed: () => context.go('/admin/vip/outreach'),
            icon: const Icon(Icons.arrow_back),
          ),
          actions: [
            IconButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _import,
          icon: const Icon(Icons.upload_file_outlined),
          label: const Text(AppStrings.vipImportExcel),
        ),
        body: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.space16),
            children: [
              if (_listCount != null && _contactRowCount != null)
                Padding(
                  key: const ValueKey('vip-inventory-counts'),
                  padding: const EdgeInsets.only(bottom: AppTokens.space16),
                  child: InsightHero(
                    child: Row(
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: AppTokens.accentMuted,
                            borderRadius: BorderRadius.circular(AppTokens.radiusMd),
                            border: Border.all(color: AppTokens.accent.withValues(alpha: 0.34)),
                          ),
                          child: const Icon(Icons.inventory_2_outlined, color: AppTokens.accent),
                        ),
                        const SizedBox(width: AppTokens.space12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'موجودی لیست‌های VIP',
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: AppTokens.space4),
                              Text(
                                '${toPersianDigits(_listCount.toString())} لیست  ·  '
                                '${toPersianDigits(_contactRowCount.toString())} مخاطب',
                                style: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(color: AppTokens.textSecondary),
                              ),
                              if (_recordedContactCount != null &&
                                  _recordedContactCount != _contactRowCount)
                                Text(
                                  'شمارش ثبت‌شده: '
                                  '${toPersianDigits(_recordedContactCount.toString())}',
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(color: AppTokens.warning),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (_lists.loading && _lists.items.isEmpty) const LoadingSkeleton(lines: 4),
              if (_lists.error != null && _lists.items.isEmpty)
                ErrorView(
                  message: friendlyError(_lists.error!),
                  onRetry: () => _loadLists(reset: true),
                ),
              if (_lists.empty)
                const EmptyStateView(title: AppStrings.vipNoLists, body: AppStrings.vipImportHelp),
              ..._lists.items.map((list) => _adminListCard(list)),
              if (_lists.error != null && _lists.items.isNotEmpty)
                ErrorView(message: friendlyError(_lists.error!), onRetry: _loadMoreLists),
              if (_lists.loading && _lists.items.isNotEmpty)
                const Center(child: CircularProgressIndicator()),
              if (_lists.hasMore && !_lists.loading && _lists.error == null)
                TextButton(
                  key: const ValueKey('vip-lists-load-more'),
                  onPressed: _loadMoreLists,
                  child: const Text(AppStrings.loadMore),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _adminListCard(VipTargetList list) {
    final attention = list.needsAttention;
    final availability = _vipInventoryAvailability(list);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space12),
      child: AppSurface(
        key: ValueKey(list.id),
        tone: AppSurfaceTone.elevated,
        onTap: () => _open(list),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: AppTokens.accent.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(AppTokens.radiusMd),
                    border: Border.all(color: AppTokens.accent.withValues(alpha: 0.24)),
                  ),
                  child: const Icon(
                    Icons.featured_play_list_outlined,
                    size: 22,
                    color: AppTokens.accent,
                  ),
                ),
                const SizedBox(width: AppTokens.space12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        list.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: AppTokens.space4),
                      Text(
                        list.regionName != null
                            ? '${list.regionCode} — ${list.regionName}'
                            : 'بدون محدوده',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: list.regionName == null
                              ? AppTokens.warning
                              : AppTokens.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppTokens.space8),
                const Icon(Icons.chevron_left_rounded, color: AppTokens.textSecondary),
              ],
            ),
            const SizedBox(height: AppTokens.space16),
            Wrap(
              spacing: AppTokens.space8,
              runSpacing: AppTokens.space8,
              children: [
                _VipInventoryTag(
                  key: ValueKey('vip-availability-${list.id}'),
                  label: availability.label,
                  icon: availability.icon,
                  color: availability.color,
                  emphasized: true,
                ),
                _VipInventoryTag(
                  label: '${toPersianDigits(list.contactCount.toString())} مخاطب',
                  icon: Icons.people_outline_rounded,
                ),
                _VipInventoryTag(
                  key: ValueKey('vip-total-requests-${list.id}'),
                  label: '${toPersianDigits(list.totalRequestCount.toString())} درخواست',
                  icon: Icons.inbox_outlined,
                  color: list.totalRequestCount > 0 ? AppTokens.accent : AppTokens.textSecondary,
                ),
                if (list.openRequestCount > 0)
                  _VipInventoryTag(
                    key: ValueKey('vip-open-requests-${list.id}'),
                    label: '${toPersianDigits(list.openRequestCount.toString())} در جریان',
                    icon: Icons.autorenew_rounded,
                    color: AppTokens.accentSecondary,
                  ),
                if (attention)
                  const _VipInventoryTag(
                    label: AppStrings.vipNeedsReview,
                    icon: Icons.warning_amber_rounded,
                    color: AppTokens.danger,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

({String label, IconData icon, Color color}) _vipInventoryAvailability(VipTargetList list) {
  if (list.requestableBySalons) {
    return (
      label: AppStrings.vipActive,
      icon: Icons.check_circle_outline_rounded,
      color: AppTokens.success,
    );
  }
  if (list.status == 'IN_USE') {
    return (
      label: AppStrings.vipInUse,
      icon: Icons.lock_clock_outlined,
      color: AppTokens.accentSecondary,
    );
  }
  return (
    label: AppStrings.vipInactive,
    icon: Icons.pause_circle_outline_rounded,
    color: list.status == 'PENDING' ? AppTokens.warning : AppTokens.textSecondary,
  );
}

class _VipInventoryTag extends StatelessWidget {
  const _VipInventoryTag({
    super.key,
    required this.label,
    required this.icon,
    this.color = AppTokens.textSecondary,
    this.emphasized = false,
  });

  final String label;
  final IconData icon;
  final Color color;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: emphasized ? 0.16 : 0.09),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: emphasized ? 0.54 : 0.26)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTokens.space12,
          vertical: AppTokens.space8,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: AppTokens.space4),
            Text(
              label,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: color,
                fontWeight: emphasized ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String vipListStatusLabel(String status) {
  switch (status) {
    case 'ACTIVE':
      return AppStrings.vipActive;
    case 'INACTIVE':
      return AppStrings.vipInactive;
    case 'IN_USE':
      return AppStrings.vipInUse;
    default:
      return AppStrings.vipPending;
  }
}

String adminVipAvailabilityLabel(VipTargetList list) {
  if (list.requestableBySalons) {
    return AppStrings.vipActive;
  }
  if (list.status == 'IN_USE') {
    return AppStrings.vipInUse;
  }
  if (list.status == 'INACTIVE') {
    return AppStrings.vipInactive;
  }
  if (list.status == 'PENDING') {
    return AppStrings.vipPending;
  }
  return AppStrings.adminVipNotYetAvailable;
}

String? adminVipUnavailabilityReason(VipTargetList list) {
  if (list.requestableBySalons) {
    return null;
  }
  if (list.status == 'IN_USE') {
    return AppStrings.adminVipInUseReason;
  }
  if (list.status == 'PENDING') {
    return AppStrings.adminVipPendingReason;
  }
  if (list.status == 'INACTIVE') {
    return AppStrings.adminVipInactiveReason;
  }
  if (!isVipCanonicalRegionCode(list.regionCode)) {
    return AppStrings.adminVipMissingRegionReason;
  }
  return AppStrings.adminVipNeedsActivationConfirm;
}

class AdminVipListDetailScreen extends ConsumerStatefulWidget {
  const AdminVipListDetailScreen({super.key, required this.listId});

  final String listId;

  @override
  ConsumerState<AdminVipListDetailScreen> createState() => _AdminVipListDetailScreenState();
}

class _AdminVipListDetailScreenState extends ConsumerState<AdminVipListDetailScreen> {
  VipTargetList? _list;
  Object? _error;
  bool _busy = false;
  late final CursorPageState<AdminVipOutreachFolder> _salonResults = CursorPageState(
    keyOf: (item) => item.salonId,
    changed: () {
      if (mounted) setState(() {});
    },
  );

  @override
  void initState() {
    super.initState();
    _load();
    _loadSalonResults();
  }

  Future<void> _loadSalonResults({bool reset = false}) async {
    if (reset) _salonResults.reset();
    await _salonResults.load(
      (cursor) =>
          ref.read(vipRepositoryProvider).adminListSalonResults(widget.listId, cursor: cursor),
    );
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(vipRepositoryProvider).adminGetList(widget.listId);
      if (!mounted) {
        return;
      }
      setState(() {
        _list = list;
        _error = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _error = error);
    }
  }

  Future<void> _confirmAvailability(VipTargetList list, String availability) async {
    final activate = availability == 'ACTIVE';
    if (!activate) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text(AppStrings.adminVipDeactivateList),
          content: const Text(AppStrings.adminVipDeactivateListConfirm),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text(AppStrings.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text(AppStrings.confirm),
            ),
          ],
        ),
      );
      if (confirmed != true) {
        return;
      }
      await _run(() async {
        await ref.read(vipRepositoryProvider).patchList(list.id, availability: availability);
      });
      return;
    }

    final selected = await showDialog<String>(
      context: context,
      builder: (context) => _ActivateVipListDialog(list: list),
    );
    if (selected == null) {
      return;
    }
    await _run(() async {
      await ref
          .read(vipRepositoryProvider)
          .patchList(list.id, availability: 'ACTIVE', regionCode: selected);
    });
  }

  Future<void> _rename(VipTargetList list) async {
    final next = await showDialog<String>(
      context: context,
      builder: (context) => _VipRenameDialog(initialName: list.name),
    );
    if (next == null) {
      return;
    }
    final name = next.trim();
    if (name.isEmpty) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text(AppStrings.vipRenameRequired)));
      return;
    }
    await _run(() async {
      await ref.read(vipRepositoryProvider).patchList(list.id, name: name);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text(AppStrings.vipRenameSuccess)));
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(error))));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      appBar: AppBar(title: Text(list?.name ?? AppStrings.vipAdminNav)),
      body: _error != null
          ? ErrorView(message: friendlyError(_error!), onRetry: _load)
          : list == null
          ? const LoadingSkeleton(lines: 6)
          : ListView(
              padding: const EdgeInsets.all(AppTokens.space16),
              children: [
                _VipListDetailHero(list: list),
                const SizedBox(height: AppTokens.space16),
                AppSurface(
                  tone: AppSurfaceTone.elevated,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('مدیریت لیست', style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: AppTokens.space12),
                      Wrap(
                        spacing: AppTokens.space8,
                        runSpacing: AppTokens.space8,
                        children: [
                          FilledButton.tonalIcon(
                            key: const ValueKey('vip-activate-list'),
                            style: const ButtonStyle(
                              visualDensity: VisualDensity.compact,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              minimumSize: WidgetStatePropertyAll(Size(0, 40)),
                              padding: WidgetStatePropertyAll(
                                EdgeInsets.symmetric(
                                  horizontal: AppTokens.space12,
                                  vertical: AppTokens.space8,
                                ),
                              ),
                            ),
                            onPressed: _busy || list.status == 'IN_USE' || list.requestableBySalons
                                ? null
                                : () => _confirmAvailability(list, 'ACTIVE'),
                            icon: const Icon(Icons.check_circle_outline_rounded, size: 18),
                            label: const Text('فعال‌سازی'),
                          ),
                          FilledButton.tonalIcon(
                            key: const ValueKey('vip-deactivate-list'),
                            style: const ButtonStyle(
                              visualDensity: VisualDensity.compact,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              minimumSize: WidgetStatePropertyAll(Size(0, 40)),
                              padding: WidgetStatePropertyAll(
                                EdgeInsets.symmetric(
                                  horizontal: AppTokens.space12,
                                  vertical: AppTokens.space8,
                                ),
                              ),
                            ),
                            onPressed: _busy || list.status == 'IN_USE'
                                ? null
                                : () => _confirmAvailability(list, 'INACTIVE'),
                            icon: const Icon(Icons.pause_circle_outline_rounded, size: 18),
                            label: const Text('غیرفعال‌سازی'),
                          ),
                          TextButton.icon(
                            style: const ButtonStyle(visualDensity: VisualDensity.compact),
                            onPressed: _busy ? null : () => _rename(list),
                            icon: const Icon(Icons.edit_outlined, size: 18),
                            label: const Text(AppStrings.vipRename),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (adminVipUnavailabilityReason(list) != null)
                  Padding(
                    key: const ValueKey('vip-unavailability-reason'),
                    padding: const EdgeInsets.only(top: AppTokens.space12),
                    child: AppSurface(
                      padding: const EdgeInsets.all(AppTokens.space12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline_rounded,
                            size: 20,
                            color: AppTokens.warning,
                          ),
                          const SizedBox(width: AppTokens.space8),
                          Expanded(
                            child: Text(
                              list.status == 'IN_USE'
                                  ? AppStrings.adminVipInUseCannotChange
                                  : adminVipUnavailabilityReason(list)!,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(color: AppTokens.textSecondary),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (list.needsAttention) ...[
                  const SizedBox(height: AppTokens.space12),
                  const _VipInventoryTag(
                    label: AppStrings.vipNeedsReview,
                    icon: Icons.warning_amber_rounded,
                    color: AppTokens.danger,
                    emphasized: true,
                  ),
                ],
                if (list.request != null) ...[
                  const SizedBox(height: AppTokens.space16),
                  AppSurface(
                    tone: AppSurfaceTone.elevated,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('درخواست جاری', style: Theme.of(context).textTheme.titleSmall),
                        const SizedBox(height: AppTokens.space8),
                        Text(
                          '${list.request!.salonName} · '
                          '${toPersianDigits(list.request!.requestedCount.toString())} مخاطب',
                        ),
                        Text(
                          list.request!.geographicRange,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: AppTokens.textSecondary),
                        ),
                        if (list.request!.sampleWorks.isNotEmpty) ...[
                          const SizedBox(height: AppTokens.space12),
                          const Text(AppStrings.vipSampleWorks),
                          ...list.request!.sampleWorks.map(
                            (image) => ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.image_outlined),
                              title: Text(
                                '${AppStrings.vipSampleWorks} '
                                '${toPersianDigits(image.position.toString())}',
                              ),
                              onTap: () async {
                                final bytes = await ref
                                    .read(vipRepositoryProvider)
                                    .downloadAdminImage(image.id);
                                await saveExcelFile(
                                  bytes: Uint8List.fromList(bytes),
                                  fileName: 'sample-${image.position}.jpg',
                                );
                              },
                            ),
                          ),
                        ],
                        const SizedBox(height: AppTokens.space12),
                        Wrap(
                          spacing: AppTokens.space8,
                          runSpacing: AppTokens.space8,
                          children: [
                            FilledButton.tonalIcon(
                              onPressed: _busy
                                  ? null
                                  : () => _run(() async {
                                      final bytes = await ref
                                          .read(vipRepositoryProvider)
                                          .exportRequest(list.request!.id);
                                      await saveExcelFile(
                                        bytes: Uint8List.fromList(bytes),
                                        fileName: 'vip-outreach.xlsx',
                                      );
                                    }),
                              icon: const Icon(Icons.download_outlined, size: 18),
                              label: const Text(AppStrings.vipExcelExport),
                            ),
                            FilledButton.tonalIcon(
                              onPressed:
                                  _busy ||
                                      (list.request!.status != 'SUBMITTED' &&
                                          list.request!.status != 'BALE_NOT_IMPLEMENTED')
                                  ? null
                                  : () => _run(
                                      () => ref
                                          .read(vipRepositoryProvider)
                                          .dispatchManual(list.request!.id, createRequestId()),
                                    ),
                              icon: const Icon(Icons.send_outlined, size: 18),
                              label: const Text(AppStrings.vipSendManual),
                            ),
                          ],
                        ),
                        if (list.request!.status == 'BALE_NOT_IMPLEMENTED')
                          const Padding(
                            padding: EdgeInsets.only(top: AppTokens.space8),
                            child: Text(AppStrings.vipBaleNotImplemented),
                          ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: AppTokens.space16),
                _VipListSalonResultsSection(
                  state: _salonResults,
                  onRetry: () => _loadSalonResults(reset: _salonResults.items.isEmpty),
                  onLoadMore: _loadSalonResults,
                ),
              ],
            ),
    );
  }
}

class _VipListSalonResultsSection extends StatelessWidget {
  const _VipListSalonResultsSection({
    required this.state,
    required this.onRetry,
    required this.onLoadMore,
  });

  final CursorPageState<AdminVipOutreachFolder> state;
  final VoidCallback onRetry;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('vip-list-salon-results'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppTokens.accentMuted,
                borderRadius: BorderRadius.circular(AppTokens.radiusSm),
              ),
              child: const Icon(Icons.storefront_outlined, size: 20, color: AppTokens.accent),
            ),
            const SizedBox(width: AppTokens.space8),
            Text(
              AppStrings.adminVipListSalonResults,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
        const SizedBox(height: AppTokens.space12),
        if (state.items.isEmpty && state.loading)
          const LoadingSkeleton(lines: 4)
        else if (state.items.isEmpty && state.error != null)
          ErrorView(message: friendlyError(state.error!), onRetry: onRetry)
        else if (state.empty)
          const AppSurface(
            child: Row(
              children: [
                Icon(Icons.inbox_outlined, color: AppTokens.textSecondary),
                SizedBox(width: AppTokens.space8),
                Expanded(child: Text(AppStrings.adminVipListSalonResultsEmpty)),
              ],
            ),
          )
        else ...[
          ...state.items.map(_VipListSalonResultCard.new),
          if (state.error != null)
            Padding(
              padding: const EdgeInsets.only(top: AppTokens.space8),
              child: ErrorView(message: friendlyError(state.error!), onRetry: onRetry),
            ),
          if (state.hasMore)
            Padding(
              padding: const EdgeInsets.only(top: AppTokens.space8),
              child: Center(
                child: TextButton.icon(
                  onPressed: state.loading ? null : onLoadMore,
                  icon: state.loading
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.expand_more_rounded),
                  label: const Text(AppStrings.loadMore),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

class _VipListSalonResultCard extends StatelessWidget {
  const _VipListSalonResultCard(this.result);

  final AdminVipOutreachFolder result;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space12),
      child: AppSurface(
        tone: AppSurfaceTone.elevated,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    result.salonName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                _VipInventoryTag(
                  label: '${toPersianDigits(result.requestCount.toString())} درخواست',
                  icon: Icons.receipt_long_outlined,
                  color: AppTokens.accent,
                  emphasized: true,
                ),
              ],
            ),
            if (result.latestActivityAt != null) ...[
              const SizedBox(height: AppTokens.space4),
              Text(
                'آخرین فعالیت: ${formatJalaliDateTime(result.latestActivityAt!)}',
                style: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(color: AppTokens.textSecondary),
              ),
            ],
            const SizedBox(height: AppTokens.space12),
            Wrap(
              spacing: AppTokens.space8,
              runSpacing: AppTokens.space8,
              children: [
                _VipInventoryTag(
                  label:
                      '${toPersianDigits(result.recipientCount.toString())} ${AppStrings.adminVipListRecipientCount}',
                  icon: Icons.people_outline_rounded,
                ),
                _VipInventoryTag(
                  label:
                      '${toPersianDigits(result.sentMessageCount.toString())} ${AppStrings.adminVipListRecordedSend}',
                  icon: Icons.check_circle_outline_rounded,
                  color: AppTokens.success,
                ),
                _VipInventoryTag(
                  label:
                      '${toPersianDigits(result.pendingMessageCount.toString())} ${AppStrings.adminVipListPendingSend}',
                  icon: Icons.schedule_outlined,
                  color: AppTokens.warning,
                ),
                if (result.failedMessageCount > 0)
                  _VipInventoryTag(
                    label:
                        '${toPersianDigits(result.failedMessageCount.toString())} ${AppStrings.adminVipListFailedSend}',
                    icon: Icons.error_outline_rounded,
                    color: AppTokens.danger,
                  ),
                if (result.cancelledMessageCount > 0)
                  _VipInventoryTag(
                    label:
                        '${toPersianDigits(result.cancelledMessageCount.toString())} ${AppStrings.adminVipListCancelledSend}',
                    icon: Icons.cancel_outlined,
                    color: AppTokens.textSecondary,
                  ),
                if (result.globallyStoppedMessageCount > 0)
                  _VipInventoryTag(
                    label:
                        '${toPersianDigits(result.globallyStoppedMessageCount.toString())} ${AppStrings.adminVipListStoppedSend}',
                    icon: Icons.block_outlined,
                    color: AppTokens.danger,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _VipListDetailHero extends StatelessWidget {
  const _VipListDetailHero({required this.list});

  final VipTargetList list;

  @override
  Widget build(BuildContext context) {
    final availability = _vipInventoryAvailability(list);
    return InsightHero(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: AppTokens.accentMuted,
                  borderRadius: BorderRadius.circular(AppTokens.radiusMd),
                  border: Border.all(color: AppTokens.accent.withValues(alpha: 0.32)),
                ),
                child: const Icon(Icons.featured_play_list_outlined, color: AppTokens.accent),
              ),
              const SizedBox(width: AppTokens.space12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      list.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: AppTokens.space4),
                    Text(
                      list.regionName != null
                          ? '${list.regionCode} — ${list.regionName}'
                          : 'بدون محدوده',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: list.regionName == null
                            ? AppTokens.warning
                            : AppTokens.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space16),
          Wrap(
            spacing: AppTokens.space8,
            runSpacing: AppTokens.space8,
            children: [
              _VipInventoryTag(
                key: const ValueKey('vip-availability-label'),
                label: availability.label,
                icon: availability.icon,
                color: availability.color,
                emphasized: true,
              ),
              _VipInventoryTag(
                label: '${toPersianDigits(list.contactCount.toString())} مخاطب',
                icon: Icons.people_outline_rounded,
              ),
              _VipInventoryTag(
                label: '${toPersianDigits(list.totalRequestCount.toString())} درخواست',
                icon: Icons.inbox_outlined,
                color: list.totalRequestCount > 0 ? AppTokens.accent : AppTokens.textSecondary,
              ),
              if (list.openRequestCount > 0)
                _VipInventoryTag(
                  label: '${toPersianDigits(list.openRequestCount.toString())} در جریان',
                  icon: Icons.autorenew_rounded,
                  color: AppTokens.accentSecondary,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActivateVipListDialog extends StatefulWidget {
  const _ActivateVipListDialog({required this.list});

  final VipTargetList list;

  @override
  State<_ActivateVipListDialog> createState() => _ActivateVipListDialogState();
}

class _ActivateVipListDialogState extends State<_ActivateVipListDialog> {
  late final String? _storedRegion = isVipCanonicalRegionCode(widget.list.regionCode)
      ? widget.list.regionCode
      : null;
  late String? _regionCode = _storedRegion;

  @override
  Widget build(BuildContext context) {
    final selected = vipCanonicalRegionByCode(_regionCode);
    final keepsStoredRegion = _storedRegion != null;
    return AlertDialog(
      title: const Text(AppStrings.adminVipActivateList),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              keepsStoredRegion
                  ? AppStrings.adminVipActivateKeepsRegion
                  : AppStrings.adminVipActivateListConfirm,
            ),
            const SizedBox(height: 12),
            Text(
              selected == null
                  ? AppStrings.adminVipSelectRegion
                  : keepsStoredRegion
                  ? '${AppStrings.adminVipStoredRegion}: ${selected.code} — ${selected.name}'
                  : '${AppStrings.adminVipSelectedRegion}: ${selected.code} — ${selected.name}',
              key: const ValueKey('vip-activate-selected-region'),
            ),
            if (!keepsStoredRegion) ...[
              const SizedBox(height: 8),
              SizedBox(
                height: 240,
                child: ListView(
                  children: [
                    for (final region in kVipCanonicalRegions)
                      ListTile(
                        key: ValueKey('vip-activate-region-${region.code}'),
                        title: Text('${region.code} — ${region.name}'),
                        selected: _regionCode == region.code,
                        onTap: () => setState(() => _regionCode = region.code),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text(AppStrings.cancel)),
        FilledButton(
          key: const ValueKey('vip-activate-confirm'),
          onPressed: _regionCode == null ? null : () => Navigator.pop(context, _regionCode),
          child: const Text(AppStrings.confirm),
        ),
      ],
    );
  }
}

class _VipRenameDialog extends StatefulWidget {
  const _VipRenameDialog({required this.initialName});

  final String initialName;

  @override
  State<_VipRenameDialog> createState() => _VipRenameDialogState();
}

class _VipRenameDialogState extends State<_VipRenameDialog> {
  late final TextEditingController _controller = TextEditingController(text: widget.initialName);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text(AppStrings.vipRename),
      content: TextField(
        controller: _controller,
        autofocus: true,
        textDirection: TextDirection.rtl,
        decoration: const InputDecoration(labelText: AppStrings.vipRename),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text(AppStrings.cancel),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: const Text(AppStrings.vipRename),
        ),
      ],
    );
  }
}
