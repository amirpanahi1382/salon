import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/jalali_date_picker.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'recovery_presentation.dart';

Future<ReturnCommitment?> showReturnCommitmentForm({
  required BuildContext context,
  required WidgetRef ref,
  required String customerId,
  String? messageRequestId,
  ReturnCommitment? existing,
  Future<ReturnCommitment> Function({
    required DateTime expectedAt,
    required String idempotencyKey,
  })? create,
  Future<ReturnCommitment> Function({
    required DateTime expectedAt,
    required DateTime updatedAt,
    required String idempotencyKey,
  })? update,
}) {
  return showModalBottomSheet<ReturnCommitment>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTokens.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppTokens.radiusLg),
      ),
    ),
    builder: (sheetContext) {
      return Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
        ),
        child: ReturnCommitmentFormSheet(
          customerId: customerId,
          messageRequestId: messageRequestId,
          existing: existing,
          create: create,
          update: update,
        ),
      );
    },
  );
}

class ReturnCommitmentFormSheet extends ConsumerStatefulWidget {
  const ReturnCommitmentFormSheet({
    super.key,
    required this.customerId,
    this.messageRequestId,
    this.existing,
    this.create,
    this.update,
  });

  final String customerId;
  final String? messageRequestId;
  final ReturnCommitment? existing;
  final Future<ReturnCommitment> Function({
    required DateTime expectedAt,
    required String idempotencyKey,
  })? create;
  final Future<ReturnCommitment> Function({
    required DateTime expectedAt,
    required DateTime updatedAt,
    required String idempotencyKey,
  })? update;

  @override
  ConsumerState<ReturnCommitmentFormSheet> createState() =>
      _ReturnCommitmentFormSheetState();
}

class _ReturnCommitmentFormSheetState
    extends ConsumerState<ReturnCommitmentFormSheet> {
  late DateTime _expectedAt;
  late String _idempotencyKey;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _idempotencyKey = createRequestId();
    final existing = widget.existing?.expectedAt;
    _expectedAt = existing != null
        ? asLocalDateTime(existing)
        : DateTime.now().add(const Duration(days: 1));
  }

  Future<void> _pickDate() async {
    final selected = await showJalaliDatePicker(
      context: context,
      initialDate: _expectedAt,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 400)),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _expectedAt = replaceLocalDateKeepingTime(_expectedAt, selected);
    });
  }

  Future<void> _pickTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_expectedAt),
    );
    if (time == null || !mounted) {
      return;
    }
    setState(() {
      _expectedAt = DateTime(
        _expectedAt.year,
        _expectedAt.month,
        _expectedAt.day,
        time.hour,
        time.minute,
      );
    });
  }

  Future<void> _save() async {
    if (_busy) {
      return;
    }
    _busy = true;
    setState(() {
      _error = null;
    });
    try {
      final repo = ref.read(returnCommitmentRepositoryProvider);
      final ReturnCommitment saved;
      if (widget.existing != null) {
        if (widget.update != null) {
          saved = await widget.update!(
            expectedAt: _expectedAt,
            updatedAt: widget.existing!.updatedAt,
            idempotencyKey: _idempotencyKey,
          );
        } else {
          saved = await repo.update(
            id: widget.existing!.id,
            expectedAt: _expectedAt,
            updatedAt: widget.existing!.updatedAt,
            idempotencyKey: _idempotencyKey,
          );
        }
      } else if (widget.create != null) {
        saved = await widget.create!(
          expectedAt: _expectedAt,
          idempotencyKey: _idempotencyKey,
        );
      } else {
        saved = await repo.create(
          messageRequestId: widget.messageRequestId!,
          expectedAt: _expectedAt,
          idempotencyKey: _idempotencyKey,
        );
      }
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(saved);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _error = friendlyError(error);
      });
      if (error.isConflict) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        messenger?.showSnackBar(
          SnackBar(content: Text(friendlyError(error))),
        );
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _error = friendlyError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTokens.surface,
      child: SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.existing == null
                  ? AppStrings.recordAgreedReturn
                  : AppStrings.editAgreedReturn,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(AppStrings.agreedReturnFormBody, style: TextStyle(height: 1.6)),
            const SizedBox(height: 16),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(AppStrings.visitDate),
              subtitle: Text(formatJalaliPrettyDate(_expectedAt)),
              trailing: const Icon(Icons.event),
              onTap: _busy ? null : _pickDate,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(AppStrings.visitTime),
              subtitle: Text(formatClock(_expectedAt)),
              trailing: const Icon(Icons.schedule),
              onTap: _busy ? null : _pickTime,
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            AppButton(
              label: AppStrings.saveAgreedReturn,
              onPressed: _busy ? null : _save,
              loading: _busy,
            ),
          ],
        ),
      ),
    ),
    );
  }
}
