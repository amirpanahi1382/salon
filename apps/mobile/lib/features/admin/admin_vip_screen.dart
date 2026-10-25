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
    changed: () { if (mounted) setState(() {}); },
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
      imported = await ref.read(vipRepositoryProvider).importList(
            bytes,
            file.name,
            createRequestId(),
          );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(error))),
      );
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
                      const Padding(
                        padding: EdgeInsets.only(bottom: AppTokens.space8),
                        child: Text(AppStrings.vipImportHelp),
                      ),
                      if (_listCount != null && _contactRowCount != null)
                        Padding(
                          key: const ValueKey('vip-inventory-counts'),
                          padding: const EdgeInsets.only(bottom: AppTokens.space8),
                          child: Text(
                            '$_listCount لیست · $_contactRowCount مخاطب'
                            '${_recordedContactCount != null && _recordedContactCount != _contactRowCount ? '\nشمارش ثبت‌شده روی لیست‌ها: $_recordedContactCount' : ''}',
                          ),
                        ),
                      if (_lists.loading && _lists.items.isEmpty)
                        const LoadingSkeleton(lines: 4),
                      if (_lists.error != null && _lists.items.isEmpty)
                        ErrorView(
                          message: friendlyError(_lists.error!),
                          onRetry: () => _loadLists(reset: true),
                        ),
                      if (_lists.empty)
                        const EmptyStateView(
                          title: AppStrings.vipNoLists,
                          body: AppStrings.vipImportHelp,
                        ),
                      ..._lists.items.map((list) => _adminListCard(list)),
                      if (_lists.error != null && _lists.items.isNotEmpty)
                        ErrorView(
                          message: friendlyError(_lists.error!),
                          onRetry: _loadMoreLists,
                        ),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space8),
        child: DecoratedBox(
        decoration: BoxDecoration(
          color: attention
              ? AppTokens.danger.withValues(alpha: 0.14)
              : AppTokens.surface,
          borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          border: Border.all(
            color: attention ? AppTokens.danger : AppTokens.line,
            width: attention ? 2 : 1,
          ),
        ),
        child: Material(
          color: Colors.transparent,
          child: ListTile(
          key: ValueKey(list.id),
          leading: attention
              ? const Icon(Icons.warning_amber_rounded, color: AppTokens.danger)
              : null,
          title: Text(list.name),
          subtitle: Text(
            [
              if (list.regionName != null) '${list.regionCode} — ${list.regionName}',
              if (list.regionName == null) AppStrings.adminVipRegionMissing,
              '${adminVipAvailabilityLabel(list)} · ${list.contactCount} مخاطب',
              list.requestableBySalons
                  ? AppStrings.adminVipRequestable
                  : AppStrings.adminVipNotRequestable,
              if (adminVipUnavailabilityReason(list) != null) adminVipUnavailabilityReason(list)!,
              '${AppStrings.adminVipListRequestTotal} ${list.totalRequestCount} · ${AppStrings.adminVipListRequestOpen} ${list.openRequestCount}',
              if (attention) AppStrings.vipNeedsReview,
            ].join('\n'),
            maxLines: 8,
          ),
          trailing: attention
              ? Text(
                  AppStrings.vipNeedsReview,
                  style: const TextStyle(color: AppTokens.danger),
                )
              : null,
          onTap: () => _open(list),
        ),
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
  ConsumerState<AdminVipListDetailScreen> createState() =>
      _AdminVipListDetailScreenState();
}

class _AdminVipListDetailScreenState extends ConsumerState<AdminVipListDetailScreen> {
  VipTargetList? _list;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
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
        await ref.read(vipRepositoryProvider).patchList(
              list.id,
              availability: availability,
            );
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
      await ref.read(vipRepositoryProvider).patchList(
            list.id,
            availability: 'ACTIVE',
            regionCode: selected,
          );
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(AppStrings.vipRenameRequired)),
      );
      return;
    }
    await _run(() async {
      await ref.read(vipRepositoryProvider).patchList(list.id, name: name);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(AppStrings.vipRenameSuccess)),
      );
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(error))),
      );
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
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        FilledButton.tonal(
                          key: const ValueKey('vip-activate-list'),
                          onPressed: _busy || list.status == 'IN_USE' || list.requestableBySalons
                              ? null
                              : () => _confirmAvailability(list, 'ACTIVE'),
                          child: const Text(AppStrings.adminVipActivateList),
                        ),
                        FilledButton.tonal(
                          key: const ValueKey('vip-deactivate-list'),
                          onPressed: _busy || list.status == 'IN_USE'
                              ? null
                              : () => _confirmAvailability(list, 'INACTIVE'),
                          child: const Text(AppStrings.adminVipDeactivateList),
                        ),
                        TextButton(
                          onPressed: _busy ? null : () => _rename(list),
                          child: const Text(AppStrings.vipRename),
                        ),
                      ],
                    ),
                    if (list.status == 'IN_USE') ...[
                      const SizedBox(height: 8),
                      const Text(AppStrings.adminVipInUseCannotChange),
                    ],
                    const SizedBox(height: 12),
                    Text('${AppStrings.vipListNameLabel}: ${list.name}'),
                    Text('${AppStrings.vipContactCountLabel}: ${list.contactCount}'),
                    Text(
                      adminVipAvailabilityLabel(list),
                      key: const ValueKey('vip-availability-label'),
                    ),
                    Text(
                      list.regionName != null
                          ? '${list.regionCode} — ${list.regionName}'
                          : AppStrings.adminVipRegionMissing,
                    ),
                    Text(
                      list.requestableBySalons
                          ? AppStrings.adminVipRequestable
                          : AppStrings.adminVipNotRequestable,
                    ),
                    if (adminVipUnavailabilityReason(list) != null)
                      Text(
                        adminVipUnavailabilityReason(list)!,
                        key: const ValueKey('vip-unavailability-reason'),
                      ),
                    Text('${AppStrings.adminVipListRequestTotal}: ${list.totalRequestCount}'),
                    Text('${AppStrings.adminVipListRequestOpen}: ${list.openRequestCount}'),
                    if (list.needsAttention) ...[
                      const SizedBox(height: 8),
                      Text(
                        AppStrings.vipNeedsReview,
                        style: const TextStyle(color: AppTokens.danger),
                      ),
                    ],
                    if (list.request != null) ...[
                      Text('${list.request!.salonName} · ${list.request!.requestedCount}'),
                      Text(list.request!.geographicRange),
                      const SizedBox(height: 12),
                      const Text(AppStrings.vipSampleWorks),
                      ...list.request!.sampleWorks.map(
                        (image) => ListTile(
                          title: Text('${AppStrings.vipSampleWorks} ${image.position}'),
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
                      FilledButton(
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
                        child: const Text(AppStrings.vipExcelExport),
                      ),
                      FilledButton(
                        onPressed: _busy ||
                                (list.request!.status != 'SUBMITTED' &&
                                    list.request!.status != 'BALE_NOT_IMPLEMENTED')
                            ? null
                            : () => _run(
                                  () => ref.read(vipRepositoryProvider).dispatchManual(
                                        list.request!.id,
                                        createRequestId(),
                                      ),
                                ),
                        child: const Text(AppStrings.vipSendManual),
                      ),
                      if (list.request!.status == 'BALE_NOT_IMPLEMENTED')
                        const Text(AppStrings.vipBaleNotImplemented),
                    ],
                    const SizedBox(height: 16),
                    ...list.contacts.map(
                      (row) => ListTile(
                        title: Text(
                          (row.displayName != null && row.displayName!.trim().isNotEmpty)
                              ? row.displayName!
                              : AppStrings.vipUnnamedContact,
                        ),
                        subtitle: LtrText(row.phoneNumber),
                      ),
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
  late String? _regionCode = isVipCanonicalRegionCode(widget.list.regionCode)
      ? widget.list.regionCode
      : null;

  @override
  Widget build(BuildContext context) {
    final selected = vipCanonicalRegionByCode(_regionCode);
    return AlertDialog(
      title: const Text(AppStrings.adminVipActivateList),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(AppStrings.adminVipActivateListConfirm),
            const SizedBox(height: 12),
            Text(
              selected == null
                  ? AppStrings.adminVipSelectRegion
                  : '${AppStrings.adminVipSelectedRegion}: ${selected.code} — ${selected.name}',
              key: const ValueKey('vip-activate-selected-region'),
            ),
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
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text(AppStrings.cancel),
        ),
        FilledButton(
          key: const ValueKey('vip-activate-confirm'),
          onPressed: _regionCode == null
              ? null
              : () => Navigator.pop(context, _regionCode),
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
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialName);

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
