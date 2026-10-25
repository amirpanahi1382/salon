import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/cursor_page_state.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'admin_messaging_shell.dart';

class AdminVipSalonAccessScreen extends ConsumerStatefulWidget {
  const AdminVipSalonAccessScreen({super.key});

  @override
  ConsumerState<AdminVipSalonAccessScreen> createState() =>
      _AdminVipSalonAccessScreenState();
}

class _AdminVipSalonAccessScreenState
    extends ConsumerState<AdminVipSalonAccessScreen> {
  late final CursorPageState<AdminSalonSummary> _salons = CursorPageState(
    keyOf: (salon) => salon.id,
    changed: () {
      if (mounted) setState(() {});
    },
  );
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;
  String _salonSearch = '';

  @override
  void initState() {
    super.initState();
    _loadMore();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _search(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      _salonSearch = value.trim();
      _salons.reset();
      _loadMore();
    });
  }

  Future<void> _loadMore() => _salons.load(
        (cursor) => ref
            .read(vipRepositoryProvider)
            .adminSalons(cursor: cursor, q: _salonSearch),
      );

  @override
  Widget build(BuildContext context) {
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: const Text(AppStrings.adminVipSalonAccessTitle),
          leading: IconButton(
            onPressed: () => context.go('/admin/vip/outreach'),
            icon: const Icon(Icons.arrow_back),
          ),
        ),
        body: ListView(
          padding: const EdgeInsets.all(AppTokens.space16),
          children: [
            TextField(
              controller: _searchController,
              onChanged: _search,
              decoration: const InputDecoration(
                labelText: AppStrings.searchSalons,
                prefixIcon: Icon(Icons.search),
              ),
            ),
            const SizedBox(height: AppTokens.space12),
            if (_salons.loading && _salons.items.isEmpty)
              const LoadingSkeleton(lines: 4),
            if (_salons.empty)
              const EmptyStateView(
                title: AppStrings.noSalons,
                body: AppStrings.noSalons,
              ),
            ..._salons.items.map(
              (salon) => Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.space8),
                child: AppSurface(
                  onTap: () => context.push('/admin/vip/salons/${salon.id}'),
                  padding: const EdgeInsets.all(AppTokens.space12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        salon.name,
                        key: ValueKey(salon.id),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        salon.entitled
                            ? AppStrings.vipActive
                            : AppStrings.vipInactive,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (_salons.error != null)
              ErrorView(
                message: friendlyError(_salons.error!),
                onRetry: _loadMore,
              ),
            if (_salons.loading && _salons.items.isNotEmpty)
              const Center(child: CircularProgressIndicator()),
            if (_salons.hasMore && !_salons.loading && _salons.error == null)
              TextButton(
                onPressed: _loadMore,
                child: const Text(AppStrings.loadMore),
              ),
          ],
        ),
      ),
    );
  }
}
