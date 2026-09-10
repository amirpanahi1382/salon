import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import 'manual_outreach_selection.dart';
import 'outreach_message_template.dart';

Future<void> openOutreachMessageComposer({
  required BuildContext context,
  required WidgetRef ref,
  required String customerId,
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
        child: OutreachMessageComposer(customerId: customerId),
      );
    },
  );
}

class OutreachMessageComposer extends ConsumerStatefulWidget {
  const OutreachMessageComposer({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<OutreachMessageComposer> createState() =>
      _OutreachMessageComposerState();
}

class _OutreachMessageComposerState extends ConsumerState<OutreachMessageComposer> {
  late final String _idempotencyKey;
  final _customerName = TextEditingController();
  final _date = TextEditingController();
  final _time = TextEditingController();
  final _discount = TextEditingController();
  final _salonName = TextEditingController();
  final _salonPhone = TextEditingController();
  bool _loading = true;
  bool _busy = false;
  String? _status;
  Object? _error;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _idempotencyKey = createRequestId();
    _load();
  }

  @override
  void dispose() {
    _customerName.dispose();
    _date.dispose();
    _time.dispose();
    _discount.dispose();
    _salonName.dispose();
    _salonPhone.dispose();
    super.dispose();
  }

  OutreachMessageDraft get _draft => OutreachMessageDraft(
        customerName: _customerName.text,
        dateLabel: _date.text,
        time: _time.text,
        discountThousands: _discount.text,
        salonName: _salonName.text,
        salonPhone: _salonPhone.text,
      );

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final customer = await ref
          .read(customerRepositoryProvider)
          .getById(widget.customerId);
      final salon = await ref.read(salonRepositoryProvider).current();
      if (!mounted) {
        return;
      }
      final draft = defaultOutreachDraft(
        customerFirstName: customer.firstName,
        salonName: salon.name,
        salonPhone: salon.phone,
      );
      _customerName.text = draft.customerName;
      _date.text = draft.dateLabel;
      _time.text = draft.time;
      _discount.text = draft.discountThousands;
      _salonName.text = draft.salonName;
      _salonPhone.text = draft.salonPhone;
      setState(() => _loading = false);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _loadError = friendlyError(error);
      });
    }
  }

  Future<void> _confirmAndSend() async {
    setState(() => _error = null);
    if (!_draft.isComplete) {
      setState(() => _error = AppStrings.outreachIncompleteFields);
      return;
    }
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
              child: const Text(AppStrings.sendMessageAction),
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
      final delivery = await ref.read(messageRepositoryProvider).sendManualOutreach(
            customerId: widget.customerId,
            text: _draft.composed,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _status = messageStatusLabel(delivery.status);
      });
      if (delivery.status == 'QUEUED' ||
          delivery.status == 'SENT' ||
          delivery.status == 'PENDING' ||
          delivery.status == 'PROCESSING') {
        ref.read(manualOutreachSelectionProvider.notifier).remove(widget.customerId);
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
        child: _loading
            ? const Padding(
                padding: EdgeInsets.all(AppTokens.space24),
                child: Center(child: CircularProgressIndicator()),
              )
            : _loadError != null
            ? ErrorView(message: _loadError!, onRetry: _load)
            : SingleChildScrollView(
                child: Column(
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
                      AppStrings.outreachComposerTitle,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: AppTokens.space12),
                    _EditableChipField(
                      label: AppStrings.outreachFieldCustomerName,
                      controller: _customerName,
                      enabled: !_busy,
                    ),
                    const _FixedLine('عزیز برای'),
                    _EditableChipField(
                      label: AppStrings.outreachFieldDate,
                      controller: _date,
                      enabled: !_busy,
                    ),
                    const _FixedLine('ساعت'),
                    _EditableChipField(
                      label: AppStrings.outreachFieldTime,
                      controller: _time,
                      enabled: !_busy,
                      keyboardType: TextInputType.datetime,
                      textDirection: TextDirection.ltr,
                    ),
                    const _FixedLine('می‌توانیم با'),
                    _EditableChipField(
                      label: AppStrings.outreachFieldDiscount,
                      controller: _discount,
                      enabled: !_busy,
                      keyboardType: TextInputType.number,
                      textDirection: TextDirection.ltr,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    ),
                    const _FixedLine('هزار تومان تخفیف در سالن'),
                    _EditableChipField(
                      label: AppStrings.outreachFieldSalonName,
                      controller: _salonName,
                      enabled: !_busy,
                    ),
                    const _FixedLine('در خدمت شما باشیم! برای رزرو این وقت با شماره'),
                    _EditableChipField(
                      label: AppStrings.outreachFieldSalonPhone,
                      controller: _salonPhone,
                      enabled: !_busy,
                      keyboardType: TextInputType.phone,
                      textDirection: TextDirection.ltr,
                    ),
                    const _FixedLine('تماس بگیرید!'),
                    const SizedBox(height: AppTokens.space16),
                    SizedBox(
                      width: double.infinity,
                      height: AppTokens.buttonHeight,
                      child: FilledButton(
                        onPressed: _busy ? null : _confirmAndSend,
                        child: _busy
                            ? const SizedBox(
                                height: 18,
                                width: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text(AppStrings.sendMessageAction),
                      ),
                    ),
                    if (_status != null) ...[
                      const SizedBox(height: AppTokens.space8),
                      Text(_status!),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: AppTokens.space8),
                      Text(
                        _error is String ? _error as String : friendlyError(_error!),
                        style: const TextStyle(color: AppColors.danger),
                      ),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}

class _FixedLine extends StatelessWidget {
  const _FixedLine(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space8),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}

class _EditableChipField extends StatelessWidget {
  const _EditableChipField({
    required this.label,
    required this.controller,
    required this.enabled,
    this.keyboardType,
    this.textDirection,
    this.inputFormatters,
  });

  final String label;
  final TextEditingController controller;
  final bool enabled;
  final TextInputType? keyboardType;
  final TextDirection? textDirection;
  final List<TextInputFormatter>? inputFormatters;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: keyboardType,
      textDirection: textDirection,
      inputFormatters: inputFormatters,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: AppTokens.accentMuted,
      ),
    );
  }
}
