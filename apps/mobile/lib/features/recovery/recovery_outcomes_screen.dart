import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
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
  List<RecoveryOutcomeReturnItem> _commitmentBacked = const [];
  List<RecoveryOutcomeReturnItem> _observed = const [];
  List<OpenAgreedReturn> _openReturns = const [];
  Object? _openReturnsError;
  Object? _error;
  bool _loading = true;
  DateTime? _weekStart;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({DateTime? weekStart}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = ref.read(returnCommitmentRepositoryProvider);
      final summary = await repo.outcomesSummary(weekStart: weekStart);
      final requestedStart = weekStart?.toUtc();
      if (requestedStart != null &&
          summary.period.start.toUtc().millisecondsSinceEpoch !=
              requestedStart.millisecondsSinceEpoch) {
        throw StateError('week mismatch');
      }
      final backed = await repo.outcomeReturns(
        kind: 'COMMITMENT_BACKED',
        weekStart: summary.period.start,
      );
      final observed = await repo.outcomeReturns(
        kind: 'OBSERVED',
        weekStart: summary.period.start,
      );
      List<OpenAgreedReturn> openReturns = const [];
      Object? openReturnsError;
      try {
        final open = await repo.listOpen();
        openReturns = open.items;
      } catch (error) {
        openReturnsError = error;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _weekStart = summary.period.start;
        _summary = summary;
        _commitmentBacked = backed.items;
        _observed = observed.items;
        _openReturns = openReturns;
        _openReturnsError = openReturnsError;
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
              items: _openReturns,
              loading: false,
              error: _openReturnsError,
              onRetry: () => _load(weekStart: _weekStart),
            ),
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
              ..._commitmentBacked.map(_backedTile),
              const SizedBox(height: AppTokens.space16),
              const SectionHeader(AppStrings.recoveryObservedReturns),
              const SizedBox(height: AppTokens.space8),
              ..._observed.map(_observedTile),
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
