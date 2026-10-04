import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../recovery/return_commitment_form.dart';
import 'admin_messaging_shell.dart';

class AdminMessageQueueScreen extends ConsumerStatefulWidget {
  const AdminMessageQueueScreen({super.key});

  @override
  ConsumerState<AdminMessageQueueScreen> createState() =>
      _AdminMessageQueueScreenState();
}

class _AdminMessageQueueScreenState extends ConsumerState<AdminMessageQueueScreen> {
  List<AdminNormalSalonFolder> _items = [];
  String? _cursor;
  bool _loading = true;
  Object? _error;
  final _search = TextEditingController();
  String _activeQuery = '';
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    final generation = ++_loadGeneration;
    final query = more ? _activeQuery : _search.text.trim();
    if (!more) {
      _activeQuery = query;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(adminMessageRepositoryProvider).listNormalSalons(
            cursor: more ? _cursor : null,
            query: query,
          );
      if (!mounted || generation != _loadGeneration) {
        return;
      }
      setState(() {
        _items = more ? [..._items, ...page.items] : page.items;
        _cursor = page.nextCursor;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || generation != _loadGeneration) {
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
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: const Text(AppStrings.adminQueueTitle),
          actions: [
            IconButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        body: _error != null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : _loading && _items.isEmpty
                ? const LoadingSkeleton(lines: 6)
                : ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      TextField(
                        controller: _search,
                        textInputAction: TextInputAction.search,
                        decoration: const InputDecoration(
                          labelText: AppStrings.adminFolderSearch,
                        ),
                        onSubmitted: (_) => _load(),
                      ),
                      const SizedBox(height: AppTokens.space16),
                      if (_items.isEmpty)
                        EmptyStateView(
                          title: _activeQuery.isEmpty
                              ? AppStrings.adminNormalFoldersEmpty
                              : AppStrings.adminNormalFoldersFilteredEmpty,
                          body: _activeQuery.isEmpty
                              ? AppStrings.adminNormalFoldersEmpty
                              : AppStrings.changeCustomerSearch,
                        )
                      else
                        for (final folder in _items) ...[
                          AppSurface(
                            onTap: () => context.push(
                              '/admin/messages/salons/${folder.salonId}',
                            ),
                            padding: const EdgeInsets.all(AppTokens.space12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  folder.salonName,
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  AppStrings.sentOfTotal(
                                    folder.sentMessageCount,
                                    folder.totalMessageCount,
                                  ),
                                ),
                                Text(
                                  '${AppStrings.vipOutreachPending} ${folder.pendingMessageCount} · ${AppStrings.vipOutreachFailed} ${folder.failedMessageCount}',
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppTokens.space8),
                        ],
                      if (_cursor != null)
                        TextButton(
                          onPressed: _loading ? null : () => _load(more: true),
                          child: const Text(AppStrings.vipOutreachLoadMore),
                        ),
                    ],
                  ),
      ),
    );
  }
}

class AdminNormalSalonFolderScreen extends ConsumerStatefulWidget {
  const AdminNormalSalonFolderScreen({super.key, required this.salonId});

  final String salonId;

  @override
  ConsumerState<AdminNormalSalonFolderScreen> createState() =>
      _AdminNormalSalonFolderScreenState();
}

class _AdminNormalSalonFolderScreenState
    extends ConsumerState<AdminNormalSalonFolderScreen> {
  AdminNormalSalonFolderDetail? _folder;
  List<AdminQueueItem> _items = [];
  String? _cursor;
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(adminMessageRepositoryProvider).getNormalSalon(
            widget.salonId,
            cursor: more ? _cursor : null,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _folder = page;
        _items = more ? [..._items, ...page.page.items] : page.page.items;
        _cursor = page.page.nextCursor;
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

  Future<void> _open(AdminQueueItem item) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTokens.surface,
      builder: (context) => AdminMessageDetailSheet(itemId: item.id),
    );
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final folder = _folder;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: Text(folder?.salonName ?? AppStrings.adminQueueTitle),
        ),
        body: _error != null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : _loading && folder == null
                ? const LoadingSkeleton(lines: 6)
                : _items.isEmpty
                    ? const EmptyStateView(
                        title: AppStrings.adminNormalFolderEmpty,
                        body: AppStrings.adminNormalFolderEmpty,
                      )
                    : ListView(
                        padding: const EdgeInsets.all(AppTokens.space16),
                        children: [
                          if (folder != null) ...[
                            Text(
                              AppStrings.sentOfTotal(
                                folder.sentMessageCount,
                                folder.totalMessageCount,
                              ),
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: AppTokens.space12),
                          ],
                          for (final item in _items) ...[
                            AppSurface(
                              onTap: () => _open(item),
                              padding: const EdgeInsets.all(AppTokens.space12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    item.customerName,
                                    style: Theme.of(context).textTheme.titleMedium,
                                  ),
                                  const SizedBox(height: 4),
                                  Text(messageStatusLabel(item.status)),
                                  if (item.canCancel)
                                    Align(
                                      alignment: Alignment.centerLeft,
                                      child: Text(
                                        AppStrings.adminRemoveFromQueue,
                                        style: TextStyle(color: AppTokens.accent),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            const SizedBox(height: AppTokens.space8),
                          ],
                          if (_cursor != null)
                            TextButton(
                              onPressed: _loading ? null : () => _load(more: true),
                              child: const Text(AppStrings.vipOutreachLoadMore),
                            ),
                        ],
                      ),
      ),
    );
  }
}

class AdminMessageDetailSheet extends ConsumerStatefulWidget {
  const AdminMessageDetailSheet({super.key, required this.itemId});

  final String itemId;

  @override
  ConsumerState<AdminMessageDetailSheet> createState() =>
      _AdminMessageDetailSheetState();
}

class _AdminMessageDetailSheetState extends ConsumerState<AdminMessageDetailSheet> {
  AdminQueueItem? _item;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    try {
      final item = await ref.read(adminMessageRepositoryProvider).getById(widget.itemId);
      if (!mounted) {
        return;
      }
      setState(() {
        _item = item;
        _error = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _error = error);
    }
  }

  Future<void> _run(Future<AdminQueueItem> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final item = await action();
      if (!mounted) {
        return;
      }
      setState(() {
        _item = item;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error;
        _busy = false;
      });
      if ((error is ApiException && error.isConflict) || error is NetworkException) {
        await _reload();
      }
    }
  }

  Future<void> _cancel(AdminQueueItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text(AppStrings.adminRemoveFromQueue),
        content: const Text(AppStrings.adminRemoveFromQueueBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(AppStrings.adminRemoveFromQueue),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) {
      return;
    }
    await _run(() => ref.read(adminMessageRepositoryProvider).cancel(item.id));
  }

  Future<void> _recordCommitment(AdminQueueItem item) async {
    final existing = item.returnCommitment;
    ReturnCommitment? existingFull;
    if (existing != null && existing.updatedAt != null) {
      existingFull = ReturnCommitment(
        id: existing.id,
        customerId: item.customerId,
        sourceRequestId: item.id,
        sourceDeliveryId: '',
        expectedAt: existing.expectedAt,
        createdAt: existing.expectedAt,
        updatedAt: existing.updatedAt!,
        actualVisitId: existing.actualVisitId,
        recordedBySupport: existing.recordedBySupport,
      );
    }
    final saved = await showReturnCommitmentForm(
      context: context,
      ref: ref,
      customerId: item.customerId,
      messageRequestId: item.id,
      existing: existingFull,
      create: ({
        required DateTime expectedAt,
        required String idempotencyKey,
      }) {
        return ref.read(adminMessageRepositoryProvider).createReturnCommitment(
              messageRequestId: item.id,
              expectedAt: expectedAt,
              idempotencyKey: idempotencyKey,
            );
      },
      update: existingFull == null
          ? null
          : ({
              required DateTime expectedAt,
              required DateTime updatedAt,
              required String idempotencyKey,
            }) {
              return ref.read(adminMessageRepositoryProvider).updateReturnCommitment(
                    id: existingFull!.id,
                    expectedAt: expectedAt,
                    updatedAt: updatedAt,
                    idempotencyKey: idempotencyKey,
                  );
            },
    );
    if (saved != null) {
      await _reload();
    }
  }

  bool _canManageCommitment(AdminQueueItem item) {
    if (item.customerId.isEmpty || item.vipRequestId != null) {
      return false;
    }
    if (item.status != 'SENT' && item.deliveryStatus != 'SENT') {
      return false;
    }
    final existing = item.returnCommitment;
    if (existing == null) {
      return true;
    }
    return existing.actualVisitId == null && existing.updatedAt != null;
  }

  @override
  Widget build(BuildContext context) {
    final item = _item;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space16),
        child: item == null
            ? const LoadingView()
            : ListView(
                shrinkWrap: true,
                children: [
                  Text('سالن: ${item.salonName}'),
                  const SizedBox(height: 8),
                  Text('مشتری: ${item.customerName}'),
                  const SizedBox(height: 8),
                  Text(
                    'شماره: ${item.customerPhone.isEmpty ? AppStrings.adminUnknownDestination : item.customerPhone}',
                  ),
                  const SizedBox(height: 8),
                  if (item.messageBusinessDate != null) ...[
                    Text('تاریخ کسب‌وکار: ${item.messageBusinessDate}'),
                    const SizedBox(height: 8),
                  ],
                  Text(opportunityLabel(item.opportunityType)),
                  const SizedBox(height: 12),
                  const Text('پیام:'),
                  const SizedBox(height: 8),
                  Text(item.messageText),
                  const SizedBox(height: 12),
                  Text(messageStatusLabel(item.status)),
                  if (item.returnCommitment != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      '${AppStrings.agreedAtLabel}: ${formatJalaliDateTime(item.returnCommitment!.expectedAt)}',
                    ),
                  ],
                  if (item.mode == 'BALE' && !item.providerReady)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(AppStrings.baleProviderNotReady),
                    ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(friendlyError(_error!)),
                  ],
                  const SizedBox(height: 16),
                  AppButton(
                    label: AppStrings.copyMessage,
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: item.messageText));
                    },
                  ),
                  if (_canManageCommitment(item)) ...[
                    const SizedBox(height: 8),
                    AppButton(
                      label: item.returnCommitment == null
                          ? AppStrings.recordAgreedReturn
                          : AppStrings.editAgreedReturn,
                      onPressed: _busy ? null : () => _recordCommitment(item),
                    ),
                  ],
                  if (item.mode == null &&
                      item.customerPhone.isNotEmpty &&
                      item.vipRequestId == null &&
                      item.status == 'QUEUED') ...[
                    const SizedBox(height: 8),
                    AppButton(
                      label: AppStrings.selectBale,
                      loading: _busy,
                      onPressed: () => _run(
                        () =>
                            ref.read(adminMessageRepositoryProvider).selectBale(item.id),
                      ),
                    ),
                  ],
                  if (item.canMarkManualSent) ...[
                    const SizedBox(height: 8),
                    AppButton(
                      label: AppStrings.adminMarkRecipientSent,
                      loading: _busy,
                      onPressed: () => _run(
                        () =>
                            ref.read(adminMessageRepositoryProvider).markManualSent(item.id),
                      ),
                    ),
                  ],
                  if (item.canCancel) ...[
                    const SizedBox(height: 8),
                    AppButton(
                      label: AppStrings.adminRemoveFromQueue,
                      loading: _busy,
                      onPressed: _busy ? null : () => _cancel(item),
                    ),
                  ],
                  if (item.mode == 'BALE' &&
                      item.customerPhone.isNotEmpty &&
                      item.status != 'SENT' &&
                      item.status != 'CANCELLED' &&
                      item.vipRequestId == null) ...[
                    const SizedBox(height: 8),
                    AppButton(
                      label: 'تلاش دوباره بله',
                      loading: _busy,
                      onPressed: () => _run(
                        () => ref.read(adminMessageRepositoryProvider).retry(item.id),
                      ),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}
