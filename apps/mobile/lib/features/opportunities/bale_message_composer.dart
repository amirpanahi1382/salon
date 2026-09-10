import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';

Future<void> openBaleMessageComposer({
  required BuildContext context,
  required WidgetRef ref,
  required String customerId,
  required String opportunityType,
  required String customerName,
  String? destinationHint,
  Future<void> Function()? onChanged,
}) {
  return showModalBottomSheet<void>(
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
        child: BaleMessageComposer(
          customerId: customerId,
          opportunityType: opportunityType,
          customerName: customerName,
          destinationHint: destinationHint,
          onChanged: onChanged,
        ),
      );
    },
  );
}

class BaleMessageComposer extends ConsumerStatefulWidget {
  const BaleMessageComposer({
    super.key,
    required this.customerId,
    required this.opportunityType,
    required this.customerName,
    this.destinationHint,
    this.onChanged,
  });

  final String customerId;
  final String opportunityType;
  final String customerName;
  final String? destinationHint;
  final Future<void> Function()? onChanged;

  @override
  ConsumerState<BaleMessageComposer> createState() => _BaleMessageComposerState();
}

class _BaleMessageComposerState extends ConsumerState<BaleMessageComposer> {
  late final TextEditingController _text;
  late final String _idempotencyKey;
  bool _busy = false;
  String? _status;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: defaultBaleMessage(widget.customerName.split(' ').first));
    _idempotencyKey = createRequestId();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _confirmAndSend() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text(AppStrings.confirmSendMessage),
          content: const Text(AppStrings.confirmSendMessageBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text(AppStrings.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text(AppStrings.sendMessage),
            ),
          ],
        );
      },
    );
    if (confirmed != true || !mounted) {
      return;
    }
    await _send();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
      _status = AppStrings.messageSending;
    });
    try {
      var delivery = await ref.read(messageRepositoryProvider).send(
            customerId: widget.customerId,
            opportunityType: widget.opportunityType,
            text: _text.text,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        if (delivery.status == 'FAILED') {
          _status = messageFailureLabel(delivery.failureCode);
        } else {
          _status = messageStatusLabel(delivery.status);
        }
      });
      if (delivery.status == 'SENT' ||
          delivery.status == 'QUEUED' ||
          delivery.status == 'PENDING' ||
          delivery.status == 'PROCESSING') {
        await widget.onChanged?.call();
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _status = null;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppTokens.space16,
          AppTokens.space8,
          AppTokens.space16,
          AppTokens.space16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTokens.line,
                  borderRadius: BorderRadius.circular(AppTokens.radiusSm),
                ),
              ),
            ),
            const SizedBox(height: AppTokens.space16),
            Text(
              AppStrings.messageComposerTitle,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppTokens.space8),
            Text(
              opportunityLabel(widget.opportunityType),
              style: theme.textTheme.titleSmall?.copyWith(
                color: AppTokens.accent,
              ),
            ),
            const SizedBox(height: AppTokens.space4),
            Text(
              widget.customerName,
              style: theme.textTheme.titleMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              '${AppStrings.baleProviderName} · ${widget.destinationHint ?? 'شماره مشتری سالن'}',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: AppTokens.space8),
            Text(
              AppStrings.recommendationNote,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: AppTokens.space12),
            TextField(
              controller: _text,
              maxLength: 4096,
              maxLines: 5,
              enabled: !_busy,
              decoration: const InputDecoration(
                labelText: AppStrings.messageTextLabel,
              ),
            ),
            const SizedBox(height: AppTokens.space8),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _confirmAndSend,
                child: _busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text(AppStrings.sendMessage),
              ),
            ),
            if (_status != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(_status!),
            ],
            if (_error != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(
                _composerError(_error!),
                style: const TextStyle(color: AppColors.danger),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _composerError(Object error) {
  if (error is ApiException && error.code == 'INFRASTRUCTURE_ERROR') {
    return AppStrings.baleNotConfigured;
  }
  return friendlyError(error);
}
