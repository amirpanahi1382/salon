import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

String opportunityActionKey(String customerId, String opportunityType) {
  return '$customerId:$opportunityType';
}

class OpportunityActionBar extends ConsumerStatefulWidget {
  const OpportunityActionBar({
    super.key,
    required this.customerId,
    required this.opportunityType,
    this.openAction,
  });

  final String customerId;
  final String opportunityType;
  final OpportunityAction? openAction;

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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (open != null) ...[
          Text(
            actionStatusLabel(open.status),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
        ],
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton(
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
                        return ref
                            .read(actionRepositoryProvider)
                            .complete(action.id);
                      }),
              child: const Text(AppStrings.markActionDone),
            ),
            OutlinedButton(
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
                        return ref
                            .read(actionRepositoryProvider)
                            .dismiss(action.id);
                      }),
              child: const Text(AppStrings.dismissAction),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          AppStrings.actionDoesNotCreateVisit,
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).textTheme.bodySmall?.color,
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
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
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            opportunityLabel(action.opportunityType),
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 4),
          Text(action.fullName),
          const SizedBox(height: 8),
          Text(actionStatusLabel(action.status)),
          const SizedBox(height: 4),
          Text(formatJalaliPrettyDate(action.createdAt)),
        ],
      ),
    );
  }
}
