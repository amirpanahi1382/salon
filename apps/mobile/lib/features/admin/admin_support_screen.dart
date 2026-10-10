import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'admin_messaging_shell.dart';

class AdminSupportListScreen extends ConsumerStatefulWidget {
  const AdminSupportListScreen({super.key});

  @override
  ConsumerState<AdminSupportListScreen> createState() =>
      _AdminSupportListScreenState();
}

class _AdminSupportListScreenState extends ConsumerState<AdminSupportListScreen> {
  List<SupportConversationSummary> _items = [];
  String? _cursor;
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  Object? _moreError;
  int _generation = 0;
  bool _routeVisible = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    final generation = ++_generation;
    setState(() {
      if (!silent) {
        _loading = true;
      }
      _error = null;
      _moreError = null;
    });
    try {
      final page = await ref.read(supportRepositoryProvider).listAdmin();
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _items = page.items;
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore || _cursor == null) {
      return;
    }
    final generation = _generation;
    setState(() {
      _loadingMore = true;
      _moreError = null;
    });
    try {
      final page = await ref.read(supportRepositoryProvider).listAdmin(cursor: _cursor);
      if (!mounted || generation != _generation) {
        return;
      }
      final seen = _items.map((item) => item.id).toSet();
      setState(() {
        _items = [
          ..._items,
          ...page.items.where((item) => seen.add(item.id)),
        ];
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _moreError = error;
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final routeVisible = ModalRoute.of(context)?.isCurrent ?? true;
    if (routeVisible && !_routeVisible) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _load(silent: true);
        }
      });
    }
    _routeVisible = routeVisible;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(title: const Text(AppStrings.adminUserSupport)),
        body: _loading
            ? const LoadingView()
            : _error != null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : RefreshIndicator(
                onRefresh: _load,
                child: _items.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: const [
                          SizedBox(height: 120),
                          EmptyStateView(
                            title: AppStrings.adminSupportEmpty,
                            body: '',
                          ),
                        ],
                      )
                    : ListView.separated(
                        physics: const AlwaysScrollableScrollPhysics(),
                        itemCount: _items.length + 1,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          if (index == _items.length) {
                            return _footer();
                          }
                          final item = _items[index];
                          return ListTile(
                            title: Text(item.userName),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item.salonName),
                                LtrText(item.userEmail),
                                Text(formatJalaliDateTime(item.lastMessageAt)),
                                Text(
                                  item.awaitingSupportReply
                                      ? AppStrings.supportNeedsReply
                                      : AppStrings.supportReplied,
                                ),
                              ],
                            ),
                            onTap: () => context.push('/admin/support/${item.id}'),
                          );
                        },
                      ),
              ),
      ),
    );
  }

  Widget _footer() {
    if (_loadingMore) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (_moreError != null) {
      return Column(
        children: [
          Text(friendlyError(_moreError!)),
          TextButton(onPressed: _loadMore, child: const Text(AppStrings.retry)),
        ],
      );
    }
    if (!_hasMore) {
      return const SizedBox(height: 24);
    }
    return TextButton(
      onPressed: _loadMore,
      child: const Text(AppStrings.supportMoreConversations),
    );
  }
}

class AdminSupportThreadScreen extends ConsumerStatefulWidget {
  const AdminSupportThreadScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<AdminSupportThreadScreen> createState() =>
      _AdminSupportThreadScreenState();
}

class _AdminSupportThreadScreenState extends ConsumerState<AdminSupportThreadScreen> {
  final _text = TextEditingController();
  SupportConversationSummary? _conversation;
  List<SupportMessage> _messages = [];
  String? _olderCursor;
  bool _hasOlder = false;
  bool _initialLoading = true;
  bool _loadingOlder = false;
  bool _sending = false;
  Object? _loadError;
  Object? _olderError;
  Object? _sendError;
  String? _pendingKey;
  String? _pendingText;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _initialLoading = true;
      _loadError = null;
    });
    try {
      final thread = await ref
          .read(supportRepositoryProvider)
          .loadAdmin(widget.conversationId);
      if (!mounted) {
        return;
      }
      setState(() {
        _conversation = thread.conversation;
        _messages = _sorted(thread.messages.items);
        _olderCursor = thread.messages.nextCursor;
        _hasOlder = thread.messages.hasMore;
        _initialLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadError = error;
        _initialLoading = false;
      });
    }
  }

  Future<void> _refresh() async {
    final generation = ++_generation;
    try {
      final thread = await ref
          .read(supportRepositoryProvider)
          .loadAdmin(widget.conversationId);
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _conversation = thread.conversation;
        _messages = _sorted(thread.messages.items);
        _olderCursor = thread.messages.nextCursor;
        _hasOlder = thread.messages.hasMore;
        _loadError = null;
      });
    } catch (error) {
      if (!mounted || generation != _generation) {
        return;
      }
      if (_messages.isEmpty) {
        setState(() => _loadError = error);
      }
    }
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || !_hasOlder || _olderCursor == null) {
      return;
    }
    final generation = _generation;
    setState(() {
      _loadingOlder = true;
      _olderError = null;
    });
    try {
      final thread = await ref.read(supportRepositoryProvider).loadAdmin(
            widget.conversationId,
            cursor: _olderCursor,
          );
      if (!mounted || generation != _generation) {
        return;
      }
      final byId = {for (final message in _messages) message.id: message};
      for (final message in thread.messages.items) {
        byId[message.id] = message;
      }
      setState(() {
        _messages = _sorted(byId.values);
        _olderCursor = thread.messages.nextCursor;
        _hasOlder = thread.messages.hasMore;
        _loadingOlder = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _olderError = error;
        _loadingOlder = false;
      });
    }
  }

  List<SupportMessage> _sorted(Iterable<SupportMessage> messages) {
    final copy = messages.toList()..sort(compareSupportMessages);
    return copy;
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty || _sending) {
      return;
    }
    if (_pendingKey == null || _pendingText != text) {
      _pendingKey = createRequestId();
      _pendingText = text;
    }
    final key = _pendingKey!;
    setState(() {
      _sending = true;
      _sendError = null;
    });
    try {
      final message = await ref.read(supportRepositoryProvider).sendAdmin(
            conversationId: widget.conversationId,
            text: text,
            idempotencyKey: key,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        final byId = {for (final row in _messages) row.id: row};
        byId[message.id] = message;
        _messages = _sorted(byId.values);
        _text.clear();
        _pendingKey = null;
        _pendingText = null;
        _sending = false;
        if (_conversation != null) {
          _conversation = SupportConversationSummary(
            id: _conversation!.id,
            userName: _conversation!.userName,
            userEmail: _conversation!.userEmail,
            salonName: _conversation!.salonName,
            lastMessageAt: message.createdAt,
            awaitingSupportReply: false,
          );
        }
      });
      await _refresh();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _sending = false;
        _sendError = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final conversation = _conversation;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: Text(conversation?.userName ?? AppStrings.adminUserSupport),
        ),
        body: _initialLoading
            ? const LoadingView()
            : _loadError != null && _messages.isEmpty
            ? ErrorView(message: friendlyError(_loadError!), onRetry: _loadInitial)
            : Column(
                children: [
                  if (conversation != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(conversation.salonName),
                            LtrText(conversation.userEmail),
                          ],
                        ),
                      ),
                    ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _refresh,
                      child: ListView(
                        reverse: true,
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        children: [
                          for (final message in _messages.reversed)
                            _AdminBubble(message: message),
                          _AdminOlder(
                            hasMore: _hasOlder,
                            loading: _loadingOlder,
                            error: _olderError,
                            onLoad: _loadOlder,
                          ),
                        ],
                      ),
                    ),
                  ),
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_sendError != null) ...[
                            Text(
                              friendlyError(_sendError!),
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                            if (_sendError is NetworkException)
                              Align(
                                alignment: AlignmentDirectional.centerStart,
                                child: TextButton(
                                  onPressed: _sending ? null : _send,
                                  child: const Text(AppStrings.retry),
                                ),
                              ),
                          ],
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _text,
                                  minLines: 1,
                                  maxLines: 4,
                                  enabled: !_sending,
                                  onChanged: (_) => setState(() {}),
                                  decoration: const InputDecoration(
                                    hintText: AppStrings.supportHint,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              _sending
                                  ? const Padding(
                                      padding: EdgeInsets.all(12),
                                      child: SizedBox(
                                        width: 22,
                                        height: 22,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      ),
                                    )
                                  : FilledButton(
                                      style: FilledButton.styleFrom(
                                        minimumSize: const Size(88, 48),
                                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                      ),
                                      onPressed: _text.text.trim().isEmpty
                                          ? null
                                          : _send,
                                      child: const Text(AppStrings.sendSupport),
                                    ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _AdminOlder extends StatelessWidget {
  const _AdminOlder({
    required this.hasMore,
    required this.loading,
    required this.error,
    required this.onLoad,
  });

  final bool hasMore;
  final bool loading;
  final Object? error;
  final VoidCallback onLoad;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Padding(
        padding: EdgeInsets.all(12),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (error != null) {
      return TextButton(onPressed: onLoad, child: const Text(AppStrings.retry));
    }
    if (!hasMore) {
      return const SizedBox.shrink();
    }
    return TextButton(
      onPressed: onLoad,
      child: const Text(AppStrings.supportOlderMessages),
    );
  }
}

class _AdminBubble extends StatelessWidget {
  const _AdminBubble({required this.message});

  final SupportMessage message;

  @override
  Widget build(BuildContext context) {
    final mine = !message.fromSalonUser;
    final label = mine
        ? (message.authorName ?? AppStrings.supportTeam)
        : (message.authorName ?? AppStrings.supportYou);
    return Align(
      alignment: mine ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 320),
        child: Card(
          margin: const EdgeInsets.symmetric(vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label),
                const SizedBox(height: 4),
                Text(message.body),
                const SizedBox(height: 6),
                Text(formatJalaliDateTime(message.createdAt)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
