import 'dart:typed_data';
import 'dart:async';

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
import 'admin_messaging_shell.dart';

class AdminVipScreen extends ConsumerStatefulWidget {
  const AdminVipScreen({super.key});

  @override
  ConsumerState<AdminVipScreen> createState() => _AdminVipScreenState();
}

class _AdminVipScreenState extends ConsumerState<AdminVipScreen> {
  List<VipTargetList> _lists = [];
  late final CursorPageState<AdminSalonSummary> _salons = CursorPageState(
    keyOf: (salon) => salon.id,
    changed: () { if (mounted) setState(() {}); },
  );
  final TextEditingController _salonSearchController = TextEditingController();
  Timer? _searchDebounce;
  String _salonSearch = '';
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _salonSearchController.dispose();
    super.dispose();
  }

  void _searchSalons(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      _salonSearch = value.trim();
      _salons.reset();
      _loadMoreSalons();
    });
  }

  Future<void> _loadMoreSalons() => _salons.load((cursor) =>
      ref.read(vipRepositoryProvider).adminSalons(cursor: cursor, q: _salonSearch));

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final vip = ref.read(vipRepositoryProvider);
      final page = await vip.adminLists();
      if (!mounted) {
        return;
      }
      setState(() {
        _lists = page.items;
        _loading = false;
      });
      _salons.reset();
      await _loadMoreSalons();
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

  Future<void> _import() async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['xlsx'],
    );
    if (file == null) {
      return;
    }
    final bytes = await file.readAsBytes();
    await ref.read(vipRepositoryProvider).importList(
          bytes,
          file.name,
          createRequestId(),
        );
    await _load();
  }

  Future<void> _open(VipTargetList item) async {
    await context.push('/admin/vip/${item.id}');
    await _load();
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
        body: _error != null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : _loading && _lists.isEmpty
                ? const LoadingSkeleton(lines: 6)
                : ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      const SectionHeader(AppStrings.vipGrant),
                      TextField(
                        controller: _salonSearchController,
                        onChanged: _searchSalons,
                        decoration: const InputDecoration(
                          labelText: AppStrings.searchSalons,
                          prefixIcon: Icon(Icons.search),
                        ),
                      ),
                      if (_salons.loading && _salons.items.isEmpty)
                        const LoadingSkeleton(lines: 2),
                      if (_salons.empty)
                        const EmptyStateView(title: AppStrings.noSalons, body: AppStrings.noSalons),
                      ..._salons.items.map(
                        (salon) => ListTile(
                          key: ValueKey(salon.id),
                          title: Text(salon.name),
                          subtitle: Text(
                            salon.entitled ? AppStrings.vipActive : AppStrings.vipInactive,
                          ),
                          trailing: salon.entitled
                              ? null
                              : TextButton(
                                  onPressed: () async {
                                    await ref.read(vipRepositoryProvider).grantEntitlement(
                                          salon.id,
                                          createRequestId(),
                                        );
                                    await _load();
                                  },
                                  child: const Text(AppStrings.activate),
                                ),
                        ),
                      ),
                      if (_salons.error != null)
                        ErrorView(
                          message: friendlyError(_salons.error!),
                          onRetry: _loadMoreSalons,
                        ),
                      if (_salons.loading && _salons.items.isNotEmpty)
                        const Center(child: CircularProgressIndicator()),
                      if (_salons.hasMore && !_salons.loading && _salons.error == null)
                        TextButton(
                          onPressed: _loadMoreSalons,
                          child: const Text(AppStrings.loadMore),
                        ),
                      const SizedBox(height: AppTokens.space24),
                      const SectionHeader(AppStrings.adminVipLists),
                      const Padding(
                        padding: EdgeInsets.only(bottom: AppTokens.space8),
                        child: Text(AppStrings.vipImportHelp),
                      ),
                      if (_lists.isEmpty)
                        const EmptyStateView(
                          title: AppStrings.vipNoLists,
                          body: AppStrings.vipNoLists,
                        ),
                      ..._lists.map((list) => _adminListCard(list)),
                    ],
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
        child: ListTile(
          leading: attention
              ? const Icon(Icons.warning_amber_rounded, color: AppTokens.danger)
              : null,
          title: Text(list.name),
          subtitle: Text(
            attention
                ? '${AppStrings.vipNeedsReview} · ${_statusLabel(list.status)} · ${list.contactCount}'
                : '${_statusLabel(list.status)} · ${list.contactCount}',
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
    );
  }

  String _statusLabel(String status) {
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
                      children: [
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => _run(
                                    () => ref.read(vipRepositoryProvider).patchList(
                                          list.id,
                                          availability: 'ACTIVE',
                                        ),
                                  ),
                          child: const Text(AppStrings.vipActive),
                        ),
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => _run(
                                    () => ref.read(vipRepositoryProvider).patchList(
                                          list.id,
                                          availability: 'INACTIVE',
                                        ),
                                  ),
                          child: const Text(AppStrings.vipInactive),
                        ),
                        TextButton(
                          onPressed: _busy ? null : () => _rename(list),
                          child: const Text(AppStrings.vipRename),
                        ),
                      ],
                    ),
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
