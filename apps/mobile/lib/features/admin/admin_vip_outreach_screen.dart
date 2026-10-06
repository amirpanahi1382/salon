import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'admin_message_queue_screen.dart';
import 'admin_messaging_shell.dart';

class AdminVipOutreachFoldersScreen extends ConsumerStatefulWidget {
  const AdminVipOutreachFoldersScreen({super.key});

  @override
  ConsumerState<AdminVipOutreachFoldersScreen> createState() =>
      _AdminVipOutreachFoldersScreenState();
}

class _AdminVipOutreachFoldersScreenState
    extends ConsumerState<AdminVipOutreachFoldersScreen> {
  List<AdminVipOutreachFolder> _folders = [];
  String? _folderCursor;
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

  Future<void> _load({bool moreFolders = false}) async {
    final generation = ++_loadGeneration;
    final query = moreFolders ? _activeQuery : _search.text.trim();
    if (!moreFolders) {
      _activeQuery = query;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final folders = await ref.read(vipRepositoryProvider).adminOutreachSalons(
            cursor: moreFolders ? _folderCursor : null,
            query: query,
          );
      if (!mounted || generation != _loadGeneration) {
        return;
      }
      setState(() {
        _folders = moreFolders ? [..._folders, ...folders.items] : folders.items;
        _folderCursor = folders.nextCursor;
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

  Widget _folderCard(AdminVipOutreachFolder folder) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space8),
      child: AppSurface(
        onTap: () => context.push('/admin/vip/outreach/${folder.salonId}'),
        padding: const EdgeInsets.all(AppTokens.space12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(folder.salonName, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('${AppStrings.vipOutreachRequests} ${folder.requestCount}'),
            Text(
              AppStrings.sentOfTotal(folder.sentMessageCount, folder.recipientCount),
            ),
            Text(
              '${AppStrings.vipOutreachPending} ${folder.pendingMessageCount} · ${AppStrings.vipOutreachFailed} ${folder.failedMessageCount}',
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: const Text(AppStrings.adminVipMessagingTitle),
          actions: [
            TextButton(
              onPressed: () => context.go('/admin/vip'),
              child: const Text(AppStrings.adminVipLists),
            ),
            IconButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        body: _error != null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : _loading && _folders.isEmpty
                ? const LoadingSkeleton(lines: 6)
                : ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      TextField(
                        controller: _search,
                        textInputAction: TextInputAction.search,
                        decoration: const InputDecoration(
                          labelText: AppStrings.vipOutreachSearch,
                        ),
                        onSubmitted: (_) => _load(),
                      ),
                      const SizedBox(height: AppTokens.space8),
                      if (_folders.isEmpty)
                        EmptyStateView(
                          title: _activeQuery.isEmpty
                              ? AppStrings.vipOutreachEmptyTitle
                              : AppStrings.vipOutreachFilteredEmptyTitle,
                          body: _activeQuery.isEmpty
                              ? AppStrings.vipOutreachEmptyBody
                              : AppStrings.vipOutreachFilteredEmptyBody,
                          compact: true,
                        )
                      else
                        ..._folders.map(_folderCard),
                      if (_folderCursor != null)
                        TextButton(
                          onPressed: _loading ? null : () => _load(moreFolders: true),
                          child: const Text(AppStrings.vipOutreachLoadMore),
                        ),
                    ],
                  ),
      ),
    );
  }
}

class AdminVipOutreachSalonScreen extends ConsumerStatefulWidget {
  const AdminVipOutreachSalonScreen({super.key, required this.salonId});

  final String salonId;

  @override
  ConsumerState<AdminVipOutreachSalonScreen> createState() =>
      _AdminVipOutreachSalonScreenState();
}

class _AdminVipOutreachSalonScreenState
    extends ConsumerState<AdminVipOutreachSalonScreen> {
  String _salonName = '';
  List<AdminVipOutreachRequest> _items = [];
  String? _cursor;
  bool _loading = true;
  Object? _error;
  bool _busy = false;

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
      final page = await ref.read(vipRepositoryProvider).adminOutreachSalon(
            widget.salonId,
            cursor: more ? _cursor : null,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _salonName = page.salonName;
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

  Future<void> _dispatch(AdminVipOutreachRequest request) async {
    setState(() => _busy = true);
    try {
      await ref.read(vipRepositoryProvider).dispatchManual(
            request.id,
            createRequestId(),
          );
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
    return AdminMessagingShell(
      child: Scaffold(
      appBar: AppBar(title: Text(_salonName.isEmpty ? AppStrings.vipOutreachFolders : _salonName)),
      body: _error != null
          ? ErrorView(message: friendlyError(_error!), onRetry: _load)
          : _loading && _items.isEmpty
              ? const LoadingSkeleton(lines: 6)
              : _items.isEmpty
                  ? const EmptyStateView(
                      title: AppStrings.vipOutreachEmptyTitle,
                      body: AppStrings.vipOutreachEmptyBody,
                    )
                  : ListView(
                      padding: const EdgeInsets.all(AppTokens.space16),
                      children: [
                        for (final request in _items) ...[
                          AppSurface(
                            onTap: () => context.push(
                              '/admin/vip/outreach/request/${request.id}',
                            ),
                            padding: const EdgeInsets.all(AppTokens.space12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  request.displayTitle ??
                                      (request.regionName == null
                                          ? request.listName
                                          : '${request.regionCode} — ${request.regionName}'),
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                                Text('${AppStrings.vipListNameLabel}: ${request.listName}'),
                                const SizedBox(height: 4),
                                Text(_requestStatus(request.status)),
                                Text(
                                  AppStrings.sentOfTotal(request.sentCount, request.recipientCount),
                                ),
                                Text(
                                  '${AppStrings.vipOutreachPending} ${request.notYetQueuedCount + request.queuedCount + request.inPipelineCount} · ${AppStrings.vipOutreachFailed} ${request.failedCount}',
                                ),
                                if (request.canDispatchManual)
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: TextButton(
                                      onPressed: _busy ? null : () => _dispatch(request),
                                      child: const Text(AppStrings.vipSendManual),
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

  String _requestStatus(String status) {
    switch (status) {
      case 'SUBMITTED':
        return AppStrings.vipNeedsReview;
      case 'MANUAL_QUEUED':
        return AppStrings.outreachStatusQueued;
      case 'BALE_NOT_IMPLEMENTED':
        return AppStrings.vipBaleNotImplemented;
      case 'CANCELLED':
        return AppStrings.failed;
      default:
        return AppStrings.vipPending;
    }
  }
}

class AdminVipOutreachRequestScreen extends ConsumerStatefulWidget {
  const AdminVipOutreachRequestScreen({super.key, required this.requestId});

  final String requestId;

  @override
  ConsumerState<AdminVipOutreachRequestScreen> createState() =>
      _AdminVipOutreachRequestScreenState();
}

class _AdminVipOutreachRequestScreenState
    extends ConsumerState<AdminVipOutreachRequestScreen> {
  AdminVipOutreachRequest? _request;
  List<AdminVipOutreachRecipient> _items = [];
  String? _cursor;
  bool _loading = true;
  Object? _error;
  String? _busyRecipientId;
  bool _dispatching = false;

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
      final page = await ref.read(vipRepositoryProvider).adminOutreachRequest(
            widget.requestId,
            cursor: more ? _cursor : null,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _request = page.request;
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

  Future<void> _openMessage(String messageRequestId) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTokens.surface,
      builder: (context) => AdminMessageDetailSheet(itemId: messageRequestId),
    );
    await _load();
  }

  Future<void> _markSent(AdminVipOutreachRecipient row) async {
    final id = row.messageRequestId;
    if (id == null || _busyRecipientId != null) {
      return;
    }
    setState(() => _busyRecipientId = row.id);
    try {
      await ref.read(adminMessageRepositoryProvider).markManualSent(id);
      await _load();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(error))),
      );
      if ((error is ApiException && error.isConflict) || error is NetworkException) {
        await _load();
      }
    } finally {
      if (mounted) {
        setState(() => _busyRecipientId = null);
      }
    }
  }

  Future<void> _cancel(AdminVipOutreachRecipient row) async {
    final id = row.messageRequestId;
    if (id == null || _busyRecipientId != null) {
      return;
    }
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
    setState(() => _busyRecipientId = row.id);
    try {
      await ref.read(adminMessageRepositoryProvider).cancel(id);
      await _load();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(error))),
      );
      if ((error is ApiException && error.isConflict) || error is NetworkException) {
        await _load();
      }
    } finally {
      if (mounted) {
        setState(() => _busyRecipientId = null);
      }
    }
  }

  Future<void> _dispatchRequest() async {
    final request = _request;
    if (request == null || !request.canDispatchManual || _dispatching) {
      return;
    }
    setState(() => _dispatching = true);
    try {
      await ref.read(vipRepositoryProvider).dispatchManual(
            request.id,
            createRequestId(),
          );
      await _load();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(error))),
      );
      if ((error is ApiException && error.isConflict) || error is NetworkException) {
        await _load();
      }
    } finally {
      if (mounted) {
        setState(() => _dispatching = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = _request;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            request?.displayTitle ?? request?.listName ?? AppStrings.vipOutreachFolders,
          ),
        ),
        body: _error != null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : _loading && request == null
                ? const LoadingSkeleton(lines: 6)
                : ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      if (request != null) ...[
                        Text(
                          request.displayTitle ??
                              (request.regionName == null
                                  ? request.listName
                                  : '${request.regionCode} — ${request.regionName}'),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text('${AppStrings.vipListNameLabel}: ${request.listName}'),
                        Text(
                          AppStrings.sentOfTotal(request.sentCount, request.recipientCount),
                        ),
                        if (request.canDispatchManual) ...[
                          const SizedBox(height: AppTokens.space8),
                          const Text(AppStrings.vipOutreachDispatchPrerequisite),
                          const SizedBox(height: AppTokens.space8),
                          AppButton(
                            label: AppStrings.vipOutreachDispatchAllManual,
                            onPressed: _dispatching ? null : _dispatchRequest,
                            loading: _dispatching,
                          ),
                        ],
                        if (_items.isEmpty && !_loading)
                          const Padding(
                            padding: EdgeInsets.only(top: AppTokens.space16),
                            child: EmptyStateView(
                              title: AppStrings.vipOutreachNoMessagesYet,
                              body: AppStrings.vipOutreachNoMessagesYet,
                              compact: true,
                            ),
                          ),
                      ],
                      for (final row in _items)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppTokens.space8),
                          child: AppSurface(
                            onTap: row.messageRequestId == null
                                ? null
                                : () => _openMessage(row.messageRequestId!),
                            padding: const EdgeInsets.all(AppTokens.space12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  (row.displayName != null && row.displayName!.trim().isNotEmpty)
                                      ? row.displayName!
                                      : AppStrings.vipUnnamedContact,
                                ),
                                LtrText(row.phoneNumber),
                                Text(vipOutreachExecutionLabel(row.executionState)),
                                if (row.messageRequestId == null)
                                  const Text(AppStrings.vipOutreachDispatchPrerequisite),
                                if (row.canMarkManualSent)
                                  Align(
                                    alignment: Alignment.centerLeft,
                                    child: TextButton(
                                      onPressed: _busyRecipientId == null
                                          ? () => _markSent(row)
                                          : null,
                                      child: const Text(AppStrings.adminMarkRecipientSent),
                                    ),
                                  ),
                                if (row.canCancel)
                                  Align(
                                    alignment: Alignment.centerLeft,
                                    child: TextButton(
                                      onPressed: _busyRecipientId == null
                                          ? () => _cancel(row)
                                          : null,
                                      child: const Text(AppStrings.adminRemoveFromQueue),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
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
