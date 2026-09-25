import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/state/cursor_page_state.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'recovery_presentation.dart';
import 'open_agreed_returns_section.dart';

class RecoveryOutcomesScreen extends ConsumerStatefulWidget {
  const RecoveryOutcomesScreen({super.key});

  @override
  ConsumerState<RecoveryOutcomesScreen> createState() =>
      _RecoveryOutcomesScreenState();
}

class _RecoveryOutcomesScreenState extends ConsumerState<RecoveryOutcomesScreen> {
  RecoveryOutcomesSummary? _summary;
  late final CursorPageState<RecoveryOutcomeReturnItem> _commitmentBacked = CursorPageState(
    keyOf: (item) => item.visitId, changed: () { if (mounted) setState(() {}); },
  );
  late final CursorPageState<RecoveryOutcomeReturnItem> _observed = CursorPageState(
    keyOf: (item) => item.visitId, changed: () { if (mounted) setState(() {}); },
  );
  late final CursorPageState<OpenAgreedReturn> _openReturns = CursorPageState(
    keyOf: (item) => item.id, changed: () { if (mounted) setState(() {}); },
  );
  Object? _error;
  bool _loading = true;
  DateTime? _weekStart;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({DateTime? weekStart}) async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _summary = null;
    });
    _commitmentBacked.reset();
    _observed.reset();
    _openReturns.reset();
    try {
      final repo = ref.read(returnCommitmentRepositoryProvider);
      final summary = await repo.outcomesSummary(weekStart: weekStart);
      final requestedStart = weekStart?.toUtc();
      if (requestedStart != null &&
          summary.period.start.toUtc().millisecondsSinceEpoch !=
              requestedStart.millisecondsSinceEpoch) {
        throw StateError('week mismatch');
      }
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _weekStart = summary.period.start;
        _summary = summary;
        _loading = false;
      });
      await Future.wait([_loadMoreBacked(), _loadMoreObserved(), _loadMoreOpen()]);
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

  Future<void> _loadMoreBacked() => _commitmentBacked.load((cursor) =>
      ref.read(returnCommitmentRepositoryProvider).outcomeReturns(
        kind: 'COMMITMENT_BACKED', weekStart: _weekStart, cursor: cursor));

  Future<void> _loadMoreObserved() => _observed.load((cursor) =>
      ref.read(returnCommitmentRepositoryProvider).outcomeReturns(
        kind: 'OBSERVED', weekStart: _weekStart, cursor: cursor));

  Future<void> _loadMoreOpen() => _openReturns.load((cursor) =>
      ref.read(returnCommitmentRepositoryProvider).listOpen(cursor: cursor));

  Widget _pageAction<T>(CursorPageState<T> page, VoidCallback retry) {
    if (page.error != null) {
      return ErrorView(message: friendlyError(page.error!), onRetry: retry);
    }
    if (page.loading) return const Center(child: CircularProgressIndicator());
    if (page.hasMore) {
      return TextButton(onPressed: retry, child: const Text(AppStrings.loadMore));
    }
    return const SizedBox.shrink();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _summary == null) {
      return const Scaffold(body: LoadingSkeleton(lines: 6));
    }
    if (_error != null && _summary == null) {
      return Scaffold(
        appBar: AppBar(title: const Text(AppStrings.recoveryOutcomesTitle)),
        body: ErrorView(message: friendlyError(_error!), onRetry: _load),
      );
    }
    final summary = _summary!;
    final theme = Theme.of(context);
    final empty = summary.sentFollowUps == 0 &&
        summary.returnCommitmentsRecorded == 0 &&
        summary.commitmentBackedReturns == 0 &&
        summary.observedReturns == 0;
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.recoveryOutcomesTitle)),
      body: RefreshIndicator(
        onRefresh: () => _load(weekStart: _weekStart),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTokens.space16,
            AppTokens.space8,
            AppTokens.space16,
            AppTokens.space32,
          ),
          children: [
            Text(
              formatOwnerBusinessWeekLabel(summary.period.start, summary.period.end),
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppTokens.space8),
            Text(AppStrings.recoveryOutcomesHint, style: theme.textTheme.bodySmall),
            const SizedBox(height: AppTokens.space12),
            OpenAgreedReturnsSection(
              items: _openReturns.items,
              loading: _openReturns.loading,
              error: _openReturns.error,
              onRetry: _loadMoreOpen,
            ),
            if (_openReturns.error == null) _pageAction(_openReturns, _loadMoreOpen),
            const SizedBox(height: AppTokens.space24),
            Row(
              children: [
                TextButton(
                  onPressed: () => _load(weekStart: summary.period.previousWeekStart),
                  child: const Text(AppStrings.recoveryPreviousWeek),
                ),
                if (!summary.period.current)
                  TextButton(
                    onPressed: () => _load(),
                    child: const Text(AppStrings.recoveryCurrentWeek),
                  ),
              ],
            ),
            if (empty)
              Padding(
                padding: const EdgeInsets.only(top: AppTokens.space24),
                child: Text(AppStrings.recoveryOutcomesEmpty),
              )
            else ...[
              MetricWidget(
                label: AppStrings.recoverySentFollowUps,
                value: toPersianDigits(summary.sentFollowUps.toString()),
              ),
              const SizedBox(height: AppTokens.space16),
              MetricWidget(
                label: AppStrings.recoveryCommitmentsRecorded,
                value: toPersianDigits(summary.returnCommitmentsRecorded.toString()),
              ),
              const SizedBox(height: AppTokens.space16),
              MetricWidget(
                label: AppStrings.recoveryCommitmentBackedReturns,
                value: toPersianDigits(summary.commitmentBackedReturns.toString()),
              ),
              const SizedBox(height: AppTokens.space16),
              MetricWidget(
                label: AppStrings.recoveryCommitmentBackedRevenue,
                value: summary.commitmentBackedRecordedRevenue.recorded
                    ? formatRecordedRial(summary.commitmentBackedRecordedRevenue.amount!)
                    : AppStrings.recoveryRevenueNone,
                size: MetricSize.compact,
              ),
              const SizedBox(height: AppTokens.space16),
              MetricWidget(
                label: AppStrings.recoveryObservedReturns,
                value: toPersianDigits(summary.observedReturns.toString()),
              ),
              const SizedBox(height: AppTokens.space8),
              Text(
                AppStrings.recoveryObservedWeaker,
                style: theme.textTheme.bodySmall,
              ),
              const SizedBox(height: AppTokens.space24),
              const SectionHeader(AppStrings.recoveryCommitmentBackedReturns),
              Text('${AppStrings.loadedCount}: ${toPersianDigits(_commitmentBacked.items.length.toString())}'),
              ..._commitmentBacked.items.map(_backedTile),
              _pageAction(_commitmentBacked, _loadMoreBacked),
              const SizedBox(height: AppTokens.space16),
              const SectionHeader(AppStrings.recoveryObservedReturns),
              Text('${AppStrings.loadedCount}: ${toPersianDigits(_observed.items.length.toString())}'),
              const SizedBox(height: AppTokens.space8),
              ..._observed.items.map(_observedTile),
              _pageAction(_observed, _loadMoreObserved),
            ],
          ],
        ),
      ),
    );
  }

  Widget _backedTile(RecoveryOutcomeReturnItem item) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space8),
      child: AppSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(item.customerName),
            Text(formatJalaliDateTime(item.visitedAt)),
            Text(associatedRevenueCopy(item.associatedRevenue)),
            TextButton(
              onPressed: () => context.push('/customers/${item.customerId}'),
              child: const Text(AppStrings.recoveryDrillDownHint),
            ),
          ],
        ),
      ),
    );
  }

  Widget _observedTile(RecoveryOutcomeReturnItem item) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space8),
      child: AppSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(item.customerName),
            Text(AppStrings.recoveryObservedReturns),
            Text(formatJalaliDateTime(item.visitedAt)),
            TextButton(
              onPressed: () => context.push('/customers/${item.customerId}'),
              child: const Text(AppStrings.recoveryDrillDownHint),
            ),
          ],
        ),
      ),
    );
  }
}
