import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class SupportConversationScreen extends ConsumerStatefulWidget {
  const SupportConversationScreen({super.key});

  @override
  ConsumerState<SupportConversationScreen> createState() =>
      _SupportConversationScreenState();
}

class _SupportConversationScreenState extends ConsumerState<SupportConversationScreen> {
  final _text = TextEditingController();
  List<SupportMessage> _messages = [];
  String? _olderCursor;
  bool _hasOlder = false;
  bool _initialLoading = true;
  bool _refreshing = false;
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
      final thread = await ref.read(supportRepositoryProvider).loadSalon();
      if (!mounted) {
        return;
      }
      setState(() {
        _applyThread(thread, replace: true);
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
    setState(() => _refreshing = true);
    try {
      final thread = await ref.read(supportRepositoryProvider).loadSalon();
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _applyThread(thread, replace: true);
        _refreshing = false;
        _loadError = null;
      });
    } catch (error) {
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _refreshing = false;
        if (_messages.isEmpty) {
          _loadError = error;
        }
      });
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
      final thread = await ref
          .read(supportRepositoryProvider)
          .loadSalon(cursor: _olderCursor);
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _messages = _merge(_messages, thread.messages.items);
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

  void _applyThread(SupportThread thread, {required bool replace}) {
    final incoming = thread.messages.items;
    _messages = replace ? _sorted(incoming) : _merge(_messages, incoming);
    _olderCursor = thread.messages.nextCursor;
    _hasOlder = thread.messages.hasMore;
  }

  List<SupportMessage> _merge(
    List<SupportMessage> current,
    List<SupportMessage> incoming,
  ) {
    final byId = {for (final message in current) message.id: message};
    for (final message in incoming) {
      byId[message.id] = message;
    }
    return _sorted(byId.values);
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
      final message = await ref.read(supportRepositoryProvider).sendSalon(
            text: text,
            idempotencyKey: key,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _messages = _merge(_messages, [message]);
        _text.clear();
        _pendingKey = null;
        _pendingText = null;
        _sending = false;
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
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.contactSupport)),
      body: _initialLoading
          ? const LoadingView()
          : _loadError != null && _messages.isEmpty
          ? ErrorView(message: friendlyError(_loadError!), onRetry: _loadInitial)
          : Column(
              children: [
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _refresh,
                    child: _messages.isEmpty
                        ? ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: const [
                              SizedBox(height: 120),
                              EmptyStateView(
                                title: AppStrings.supportEmpty,
                                body: '',
                              ),
                            ],
                          )
                        : ListView(
                            reverse: true,
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.all(16),
                            children: [
                              for (final message in _messages.reversed)
                                _SupportBubble(
                                  message: message,
                                  mine: message.fromSalonUser,
                                  mineLabel: AppStrings.supportYou,
                                  otherLabel: AppStrings.supportTeam,
                                ),
                              _OlderMessagesControl(
                                hasMore: _hasOlder,
                                loading: _loadingOlder,
                                error: _olderError,
                                onLoad: _loadOlder,
                              ),
                            ],
                          ),
                  ),
                ),
                if (_refreshing) const LinearProgressIndicator(minHeight: 2),
                _composer(),
              ],
            ),
    );
  }

  Widget _composer() {
    final canSend = _text.text.trim().isNotEmpty && !_sending;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_sendError != null) ...[
              Text(
                friendlyError(_sendError!),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
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
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : FilledButton(
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(88, 48),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        onPressed: canSend ? _send : null,
                        child: const Text(AppStrings.sendSupport),
                      ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _OlderMessagesControl extends StatelessWidget {
  const _OlderMessagesControl({
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
        padding: EdgeInsets.symmetric(vertical: 12),
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
      return Column(
        children: [
          Text(friendlyError(error!)),
          Text(AppStrings.supportOlderFailed),
          TextButton(onPressed: onLoad, child: const Text(AppStrings.retry)),
        ],
      );
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

class _SupportBubble extends StatelessWidget {
  const _SupportBubble({
    required this.message,
    required this.mine,
    required this.mineLabel,
    required this.otherLabel,
  });

  final SupportMessage message;
  final bool mine;
  final String mineLabel;
  final String otherLabel;

  @override
  Widget build(BuildContext context) {
    final label = mine ? mineLabel : (message.authorName ?? otherLabel);
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
                Text(label, style: Theme.of(context).textTheme.labelMedium),
                const SizedBox(height: 4),
                Text(message.body),
                const SizedBox(height: 6),
                Text(
                  formatJalaliDateTime(message.createdAt),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
