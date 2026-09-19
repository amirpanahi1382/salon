import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../recovery/return_commitment_form.dart';

class AdminMessageQueueScreen extends ConsumerStatefulWidget {
  const AdminMessageQueueScreen({super.key});

  @override
  ConsumerState<AdminMessageQueueScreen> createState() =>
      _AdminMessageQueueScreenState();
}

class _AdminMessageQueueScreenState extends ConsumerState<AdminMessageQueueScreen> {
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
      final page = await ref.read(adminMessageRepositoryProvider).list(
            cursor: more ? _cursor : null,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _items = more ? [..._items, ...page.items] : page.items;
        _cursor = page.nextCursor;
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
    return Scaffold(
      appBar: AppBar(
        title: const Text(AppStrings.adminQueueTitle),
        actions: [
          TextButton(
            onPressed: () => context.go('/admin/vip'),
            child: const Text(AppStrings.vipAdminNav),
          ),
          IconButton(
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: _error != null
          ? ErrorView(message: friendlyError(_error!), onRetry: _load)
          : _items.isEmpty && !_loading
              ? const EmptyStateView(
                  title: AppStrings.adminQueueEmpty,
                  body: AppStrings.adminQueueEmpty,
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(AppTokens.space16),
                  itemCount: _items.length + (_cursor != null ? 1 : 0),
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    if (index >= _items.length) {
                      return TextButton(
                        onPressed: _loading ? null : () => _load(more: true),
                        child: const Text('موارد بیشتر'),
                      );
                    }
                    final item = _items[index];
                    return ListTile(
                      tileColor: AppTokens.surface,
                      title: Text(item.customerName),
                      subtitle: Text(
                        '${item.salonName}\n${messageStatusLabel(item.status)}',
                      ),
                      isThreeLine: true,
                      onTap: () => _open(item),
                    );
                  },
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
    }
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
                  Text('شماره: ${item.customerPhone}'),
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
                  if (item.mode == null) ...[
                    if (item.vipRequestId == null) ...[
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
                    const SizedBox(height: 8),
                    AppButton(
                      label: AppStrings.selectManual,
                      loading: _busy,
                      onPressed: () => _run(
                        () => ref.read(adminMessageRepositoryProvider).selectManual(item.id),
                      ),
                    ),
                  ],
                  if (item.mode == 'MANUAL' && item.status != 'SENT') ...[
                    const SizedBox(height: 8),
                    AppButton(
                      label: AppStrings.markManualSent,
                      loading: _busy,
                      onPressed: () => _run(
                        () =>
                            ref.read(adminMessageRepositoryProvider).markManualSent(item.id),
                      ),
                    ),
                  ],
                  if (item.mode == 'BALE' &&
                      item.status != 'SENT' &&
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
