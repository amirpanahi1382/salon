import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/providers.dart';
import '../../core/state/cursor_page_state.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'open_agreed_returns_section.dart';

class OpenAgreedReturnsScreen extends ConsumerStatefulWidget {
  const OpenAgreedReturnsScreen({super.key});

  @override
  ConsumerState<OpenAgreedReturnsScreen> createState() =>
      _OpenAgreedReturnsScreenState();
}

class _OpenAgreedReturnsScreenState
    extends ConsumerState<OpenAgreedReturnsScreen> {
  late final CursorPageState<OpenAgreedReturn> _page = CursorPageState(
    keyOf: (item) => item.id, changed: () { if (mounted) setState(() {}); },
  );

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async { _page.reset(); await _loadMore(); }

  Future<void> _loadMore() => _page.load((cursor) =>
      ref.read(returnCommitmentRepositoryProvider).listOpen(cursor: cursor));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.openAgreedReturnsTitle)),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTokens.space16,
            AppTokens.space8,
            AppTokens.space16,
            AppTokens.space32,
          ),
          children: [
            OpenAgreedReturnsSection(
              items: _page.items,
              loading: _page.loading,
              error: _page.error,
              onRetry: _loadMore,
            ),
            if (_page.loading && _page.items.isNotEmpty)
              const Center(child: CircularProgressIndicator()),
            if (_page.hasMore && !_page.loading && _page.error == null)
              TextButton(onPressed: _loadMore, child: const Text(AppStrings.loadMore)),
          ],
        ),
      ),
    );
  }
}

class OpenAgreedReturnsEntry extends StatelessWidget {
  const OpenAgreedReturnsEntry({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppSurface(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            AppStrings.openAgreedReturnsTitle,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: AppTokens.space8),
          Text(
            AppStrings.openAgreedReturnsHint,
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
