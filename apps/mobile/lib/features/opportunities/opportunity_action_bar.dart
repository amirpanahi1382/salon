import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'bale_message_composer.dart';

String opportunityActionKey(String customerId, String opportunityType) {
  return '$customerId:$opportunityType';
}

enum OpportunityActionLayout { wrap, stacked }

class OpportunityActionBar extends ConsumerStatefulWidget {
  const OpportunityActionBar({
    super.key,
    required this.customerId,
    required this.opportunityType,
    required this.customerName,
    this.destinationHint,
    this.openAction,
    this.layout = OpportunityActionLayout.wrap,
  });

  final String customerId;
  final String opportunityType;
  final String customerName;
  final String? destinationHint;
  final OpportunityAction? openAction;
  final OpportunityActionLayout layout;

  @override
  ConsumerState<OpportunityActionBar> createState() =>
      _OpportunityActionBarState();
}

class _OpportunityActionBarState extends ConsumerState<OpportunityActionBar> {
  bool _busy = false;
  Object? _error;

  Future<void> _run(Future<OpportunityAction> Function() work) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await work();
      if (!mounted) {
        return;
      }
      setState(() => _busy = false);
      final onChanged = OpportunityActionsScope.maybeOf(context)?.onChanged;
      await onChanged?.call();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  Future<OpportunityAction> _ensureOpen() {
    return ref.read(actionRepositoryProvider).create(
          customerId: widget.customerId,
          opportunityType: widget.opportunityType,
          idempotencyKey: createRequestId(),
        );
  }

  @override
  Widget build(BuildContext context) {
    final open = widget.openAction;
    final done = FilledButton(
      onPressed: _busy
          ? null
          : () => _run(() async {
                final action = await _ensureOpen();
                if (action.status == 'COMPLETED') {
                  return action;
                }
                if (action.status != 'OPEN') {
                  throw StateError(action.status);
                }
                return ref.read(actionRepositoryProvider).complete(action.id);
              }),
      child: const Text(AppStrings.markActionDone),
    );
    final dismiss = OutlinedButton(
      onPressed: _busy
          ? null
          : () => _run(() async {
                final action = await _ensureOpen();
                if (action.status == 'DISMISSED') {
                  return action;
                }
                if (action.status != 'OPEN') {
                  throw StateError(action.status);
                }
                return ref.read(actionRepositoryProvider).dismiss(action.id);
              }),
      child: const Text(AppStrings.dismissAction),
    );
    final bale = OutlinedButton(
      onPressed: _busy
          ? null
          : () async {
              await openBaleMessageComposer(
                context: context,
                ref: ref,
                customerId: widget.customerId,
                opportunityType: widget.opportunityType,
                customerName: widget.customerName,
                destinationHint: widget.destinationHint,
                onChanged:
                    OpportunityActionsScope.maybeOf(context)?.onChanged,
              );
            },
      child: const Text(AppStrings.sendBaleMessage),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (open != null) ...[
          ActionStatusMark(status: open.status),
          const SizedBox(height: AppTokens.space8),
        ],
        if (widget.layout == OpportunityActionLayout.stacked) ...[
          SizedBox(width: double.infinity, child: done),
          const SizedBox(height: AppTokens.space8),
          Row(
            children: [
              Expanded(child: dismiss),
              const SizedBox(width: AppTokens.space8),
              Expanded(child: bale),
            ],
          ),
        ] else
          Wrap(
            spacing: AppTokens.space8,
            runSpacing: AppTokens.space8,
            children: [done, dismiss, bale],
          ),
        const SizedBox(height: AppTokens.space8),
        Text(
          AppStrings.actionDoesNotCreateVisit,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTokens.space8),
          Text(
            friendlyError(_error!),
            style: const TextStyle(color: AppColors.danger),
          ),
        ],
      ],
    );
  }
}

class OpportunityActionsScope extends InheritedWidget {
  const OpportunityActionsScope({
    super.key,
    required this.onChanged,
    required super.child,
  });

  final Future<void> Function() onChanged;

  static OpportunityActionsScope? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<OpportunityActionsScope>();
  }

  @override
  bool updateShouldNotify(OpportunityActionsScope oldWidget) =>
      onChanged != oldWidget.onChanged;
}

class ActionHistoryTile extends StatelessWidget {
  const ActionHistoryTile({super.key, required this.action});

  final OpportunityAction action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OpportunityTypeMark(type: action.opportunityType),
          const SizedBox(height: AppTokens.space8),
          Text(
            action.fullName,
            style: theme.textTheme.titleMedium,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppTokens.space8),
          ActionStatusMark(status: action.status),
          const SizedBox(height: AppTokens.space4),
          Text(
            formatJalaliPrettyDate(action.createdAt),
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
