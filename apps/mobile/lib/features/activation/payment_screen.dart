import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../features/agreement/agreement_screen.dart';
import 'activation_repository.dart';

typedef ReceiptImagePicker = Future<({Uint8List bytes, String name})?> Function();
typedef CopyText = Future<void> Function(String value);

const paymentWaitingText =
    'واریز شما در حال بررسی است. به محض تأیید، امکانات برنامه برای شما باز می‌شود.';
const paymentUnavailableText = 'پرداخت در حال حاضر در دسترس نیست.';
const paymentUploadLabel = 'برای بارگذاری فیش واریز کلیک کنید';

class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({
    super.key,
    this.pickImage,
    this.copyText,
    this.pollInterval = const Duration(seconds: 15),
  });

  final ReceiptImagePicker? pickImage;
  final CopyText? copyText;
  final Duration pollInterval;

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen>
    with SingleTickerProviderStateMixin {
  ActivationStatus? _status;
  Object? _error;
  bool _loading = true;
  bool _unpublished = false;
  bool _uploading = false;
  bool _submitting = false;
  int? _sent;
  int? _total;
  Uint8List? _preview;
  String? _receiptId;
  String? _submitKey;
  Timer? _poll;
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(vsync: this, duration: const Duration(seconds: 2));
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  Future<({Uint8List bytes, String name})?> _pick() {
    final custom = widget.pickImage;
    if (custom != null) {
      return custom();
    }
    return _pickFromDevice();
  }

  Future<void> _copy(String value) {
    final custom = widget.copyText;
    if (custom != null) {
      return custom(value);
    }
    return Clipboard.setData(ClipboardData(text: value));
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final status = await ref.read(activationRepositoryProvider).status();
      if (!mounted) return;
      setState(() {
        _status = status;
        _unpublished = false;
        _loading = false;
        if (status.receiptReady && status.receiptId != null) {
          _receiptId = status.receiptId;
        }
      });
      _syncPoll(status);
      if (status.phase == 'APPROVED') {
        await _exchange();
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.statusCode == 404) {
        setState(() {
          _unpublished = true;
          _loading = false;
        });
        return;
      }
      setState(() {
        _error = error;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  void _syncPoll(ActivationStatus status) {
    _poll?.cancel();
    _poll = null;
    final waiting = status.phase == 'UNDER_REVIEW' || status.phase == 'APPROVED';
    if (waiting) {
      if (!_pulse.isAnimating) {
        _pulse.repeat(reverse: true);
      }
    } else {
      _pulse.stop();
    }
    if (status.phase != 'UNDER_REVIEW') {
      return;
    }
    _poll = Timer.periodic(widget.pollInterval, (_) => _refreshQuietly());
  }

  Future<void> _refreshQuietly() async {
    try {
      final status = await ref.read(activationRepositoryProvider).status();
      if (!mounted) return;
      setState(() => _status = status);
      _syncPoll(status);
      if (status.phase == 'APPROVED') {
        await _exchange();
      }
    } catch (_) {
      // Keep the waiting screen. The next poll, or a restart, asks the server again.
    }
  }

  Future<void> _exchange() async {
    _poll?.cancel();
    try {
      await ref.read(authControllerProvider.notifier).adoptProductSession();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  Future<void> _upload() async {
    final picked = await _pick();
    if (picked == null || !mounted) {
      return;
    }
    setState(() {
      _uploading = true;
      _error = null;
      _preview = picked.bytes;
      _sent = 0;
      _total = picked.bytes.length;
      _receiptId = null;
    });
    try {
      final stored = await ref.read(activationRepositoryProvider).upload(
            bytes: picked.bytes,
            filename: picked.name,
            onProgress: (sent, total) {
              if (!mounted) return;
              setState(() {
                _sent = sent;
                _total = total;
              });
            },
          );
      if (stored.phase != 'STORED') {
        throw const ApiException(statusCode: 409, code: 'CONFLICT', message: 'تصویر فیش ذخیره نشد.');
      }
      final status = await ref.read(activationRepositoryProvider).status();
      if (!mounted) return;
      setState(() {
        _status = status;
        _receiptId = status.receiptReady ? stored.receiptId : null;
        _uploading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _receiptId = null;
        _error = error;
      });
    }
  }

  Future<void> _submit() async {
    final receiptId = _receiptId;
    final ready = _status?.receiptReady == true && receiptId != null && !_submitting;
    if (!ready) {
      return;
    }
    final key = _submitKey ?? createRequestId();
    _submitKey = key;
    setState(() => _submitting = true);
    try {
      await ref.read(activationRepositoryProvider).submit(
            receiptId: receiptId,
            idempotencyKey: key,
          );
      _submitKey = null;
      if (!mounted) return;
      final status = await ref.read(activationRepositoryProvider).status();
      if (!mounted) return;
      setState(() {
        _status = status;
        _submitting = false;
        _preview = null;
        _receiptId = null;
      });
      _syncPoll(status);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: LoadingView());
    }
    if (_unpublished) {
      return const AgreementRecordedScreen();
    }
    final status = _status;
    if (status == null) {
      return Scaffold(body: _ErrorPane(error: _error, onRetry: _load));
    }
    if (status.phase == 'UNDER_REVIEW' || status.phase == 'APPROVED') {
      return _WaitingScreen(pulse: _pulse);
    }
    if (status.phase == 'PAYMENT_UNAVAILABLE') {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppTokens.space24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(paymentUnavailableText, key: const Key('payment-unavailable')),
                if (status.rejectionReason != null) ...[
                  const SizedBox(height: AppTokens.space16),
                  Text(status.rejectionReason!, key: const Key('payment-rejection-reason')),
                ],
              ],
            ),
          ),
        ),
      );
    }
    final instructions = status.instructions;
    if (instructions == null) {
      return Scaffold(body: _ErrorPane(error: _error, onRetry: _load));
    }
    final canSubmit = status.receiptReady && _receiptId != null && !_uploading && !_submitting;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.space24),
          children: [
            Text('راهنمای واریز', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: AppTokens.space8),
            Text(instructions.notice, key: const Key('payment-notice')),
            if (status.rejectionReason != null) ...[
              const SizedBox(height: AppTokens.space16),
              AppSurface(
                tone: AppSurfaceTone.hero,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('این فیش تأیید نشد'),
                    const SizedBox(height: AppTokens.space8),
                    Text(status.rejectionReason!, key: const Key('payment-rejection-reason')),
                    const SizedBox(height: AppTokens.space8),
                    const Text('می‌توانید تصویر دیگری بارگذاری و دوباره ارسال کنید.'),
                  ],
                ),
              ),
            ],
            const SizedBox(height: AppTokens.space16),
            _InstructionCard(
              label: 'شماره کارت',
              value: instructions.cardNumber,
              valueKey: const Key('payment-card-number'),
              copyKey: const Key('copy-card-number'),
              onCopy: () => _copy(instructions.cardNumberCopy),
            ),
            const SizedBox(height: AppTokens.space12),
            _InstructionCard(
              label: 'صاحب کارت',
              value: instructions.cardholderName,
              valueKey: const Key('payment-cardholder'),
            ),
            const SizedBox(height: AppTokens.space12),
            _InstructionCard(
              label: 'مبلغ',
              value: instructions.amountLabel,
              valueKey: const Key('payment-amount'),
              copyKey: const Key('copy-amount'),
              onCopy: () => _copy(instructions.amountCopy),
            ),
            const SizedBox(height: AppTokens.space24),
            OutlinedButton(
              key: const Key('receipt-picker'),
              onPressed: _uploading ? null : _upload,
              child: Text(_preview == null ? paymentUploadLabel : 'تغییر تصویر'),
            ),
            if (_uploading) ...[
              const SizedBox(height: AppTokens.space12),
              LinearProgressIndicator(
                key: const Key('receipt-upload-progress'),
                value: _total == null || _total == 0 ? null : (_sent ?? 0) / _total!,
              ),
            ],
            if (_preview != null) ...[
              const SizedBox(height: AppTokens.space12),
              ClipRRect(
                key: const Key('receipt-preview'),
                borderRadius: BorderRadius.circular(AppTokens.radiusMd),
                child: Image.memory(
                  _preview!,
                  height: 180,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) => const SizedBox(height: 180),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: AppTokens.space12),
              Text(_message(_error!), key: const Key('payment-error')),
              TextButton(
                key: const Key('payment-retry'),
                onPressed: _uploading ? null : _upload,
                child: const Text('تلاش دوباره'),
              ),
            ],
            const SizedBox(height: AppTokens.space16),
            AppButton(
              key: const Key('receipt-submit'),
              label: 'پرداخت کردم',
              loading: _submitting,
              onPressed: canSubmit ? _submit : null,
            ),
          ],
        ),
      ),
    );
  }

  String _message(Object error) {
    if (error is ApiException) {
      return error.message;
    }
    if (error is NetworkException) {
      return 'ارتباط برقرار نشد. تصویر هنوز برای بررسی ارسال نشده است.';
    }
    return 'بارگذاری فیش ناموفق بود.';
  }
}

class _WaitingScreen extends StatelessWidget {
  const _WaitingScreen({required this.pulse});

  final Animation<double> pulse;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppTokens.space32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                FadeTransition(
                  opacity: Tween<double>(begin: 0.45, end: 1).animate(pulse),
                  child: const Icon(Icons.hourglass_top, size: 56, color: AppTokens.accent),
                ),
                const SizedBox(height: AppTokens.space8),
                const Icon(Icons.account_balance_outlined, color: AppTokens.textSecondary),
                const SizedBox(height: AppTokens.space24),
                Semantics(
                  label: paymentWaitingText,
                  child: Text(
                    paymentWaitingText,
                    key: const Key('payment-waiting'),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InstructionCard extends StatelessWidget {
  const _InstructionCard({
    required this.label,
    required this.value,
    required this.valueKey,
    this.copyKey,
    this.onCopy,
  });

  final String label;
  final String value;
  final Key valueKey;
  final Key? copyKey;
  final VoidCallback? onCopy;

  @override
  Widget build(BuildContext context) {
    return AppSurface(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: AppTokens.space4),
                Text(value, key: valueKey, style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
          ),
          if (onCopy != null)
            IconButton(
              key: copyKey,
              tooltip: 'کپی',
              onPressed: onCopy,
              icon: const Icon(Icons.copy),
            ),
        ],
      ),
    );
  }
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({required this.error, required this.onRetry});

  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final failure = error;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(failure is ApiException ? failure.message : 'وضعیت پرداخت خوانده نشد.'),
            TextButton(onPressed: onRetry, child: const Text('تلاش دوباره')),
          ],
        ),
      ),
    );
  }
}

Future<({Uint8List bytes, String name})?> _pickFromDevice() async {
  final file = await FilePicker.pickFile(type: FileType.image);
  if (file == null) {
    return null;
  }
  return (bytes: Uint8List.fromList(await file.readAsBytes()), name: file.name);
}
