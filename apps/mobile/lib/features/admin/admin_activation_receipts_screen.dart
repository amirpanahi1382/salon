import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../activation/activation_repository.dart';
import 'admin_messaging_shell.dart';

class AdminActivationReceiptsScreen extends ConsumerStatefulWidget {
  const AdminActivationReceiptsScreen({super.key});

  @override
  ConsumerState<AdminActivationReceiptsScreen> createState() =>
      _AdminActivationReceiptsScreenState();
}

class _AdminActivationReceiptsScreenState extends ConsumerState<AdminActivationReceiptsScreen> {
  List<ActivationReceiptSummary> _items = [];
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await ref.read(activationRepositoryProvider).listPending();
      if (!mounted) return;
      setState(() {
        _items = items;
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

  @override
  Widget build(BuildContext context) {
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(title: const Text(AppStrings.adminActivationReceipts)),
        body: _loading
            ? const LoadingView()
            : _error != null
                ? _Failure(error: _error!, onRetry: _load)
                : _items.isEmpty
                    ? const EmptyStateView(
                        title: 'فیشی در انتظار بررسی نیست.',
                        body: 'وقتی صاحب سالن فیش واریز را ارسال کند، اینجا دیده می‌شود.',
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(AppTokens.space16),
                        itemCount: _items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: AppTokens.space12),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          return AppSurface(
                            key: Key('activation-receipt-${item.id}'),
                            onTap: () => context.push('/admin/activation-receipts/${item.id}'),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item.salonName, style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: AppTokens.space4),
                                Text(item.ownerName),
                                const SizedBox(height: AppTokens.space4),
                                Text(_when(item.submittedAt)),
                                const SizedBox(height: AppTokens.space4),
                                Text(_phaseLabel(item.phase), key: Key('activation-phase-${item.id}')),
                              ],
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}

class AdminActivationReceiptScreen extends ConsumerStatefulWidget {
  const AdminActivationReceiptScreen({super.key, required this.receiptId});

  final String receiptId;

  @override
  ConsumerState<AdminActivationReceiptScreen> createState() =>
      _AdminActivationReceiptScreenState();
}

class _AdminActivationReceiptScreenState extends ConsumerState<AdminActivationReceiptScreen> {
  ActivationReceiptReview? _review;
  List<int>? _image;
  bool _loading = true;
  bool _busy = false;
  bool _attested = false;
  bool _imageReady = false;
  bool _renderFailed = false;
  Object? _error;
  String? _decisionKey;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AdminActivationReceiptScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.receiptId != widget.receiptId) {
      _decisionKey = null;
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _image = null;
      _imageReady = false;
      _renderFailed = false;
      _attested = false;
    });
    try {
      final repository = ref.read(activationRepositoryProvider);
      final review = await repository.review(widget.receiptId);
      List<int>? image;
      Object? imageError;
      try {
        image = await repository.image(widget.receiptId);
      } catch (error) {
        imageError = error;
      }
      if (!mounted) return;
      setState(() {
        _review = review;
        _image = image;
        _error = imageError;
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

  Future<void> _approve() async {
    final review = _review;
    if (review == null || !_imageReady || _renderFailed || !_attested || _image == null || review.requiredBankAttestation.isEmpty) {
      return;
    }
    final key = _decisionKey ?? createRequestId();
    _decisionKey = key;
    setState(() => _busy = true);
    try {
      await ref.read(activationRepositoryProvider).approve(
            id: widget.receiptId,
            idempotencyKey: key,
            bankAttestation: review.requiredBankAttestation,
          );
      _decisionKey = null;
      if (!mounted) return;
      context.go('/admin/activation-receipts');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  void _scheduleImageResult(bool ready) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (ready) {
        if (_imageReady && !_renderFailed) return;
        setState(() {
          _imageReady = true;
          _renderFailed = false;
        });
        return;
      }
      if (_renderFailed && !_imageReady && !_attested) return;
      setState(() {
        _imageReady = false;
        _renderFailed = true;
        _attested = false;
      });
    });
  }

  Future<void> _reject() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => const _RejectDialog(),
    );
    if (reason == null || !mounted) {
      return;
    }
    final key = _decisionKey ?? createRequestId();
    _decisionKey = key;
    setState(() => _busy = true);
    try {
      await ref.read(activationRepositoryProvider).reject(
            id: widget.receiptId,
            reason: reason,
            idempotencyKey: key,
          );
      _decisionKey = null;
      if (!mounted) return;
      context.go('/admin/activation-receipts');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final review = _review;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(title: const Text(AppStrings.adminActivationReceipts)),
        body: _loading
            ? const LoadingView()
            : review == null
                ? _Failure(error: _error!, onRetry: _load)
                : ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      Text(review.notice, key: const Key('admin-payment-notice')),
                      const SizedBox(height: AppTokens.space16),
                      Text(review.salonName, key: const Key('admin-receipt-salon')),
                      Text(review.ownerName, key: const Key('admin-receipt-owner')),
                      Text(_when(review.submittedAt), key: const Key('admin-receipt-time')),
                      Text(_phaseLabel(review.phase), key: const Key('admin-receipt-phase')),
                      const SizedBox(height: AppTokens.space12),
                      Text(review.agreementVersionKey),
                      Text(review.amountLabel, key: const Key('admin-receipt-amount')),
                      Text(review.cardholderName),
                      Text(review.cardNumber),
                      if (review.rejectionReason != null)
                        Text(review.rejectionReason!, key: const Key('admin-receipt-reason')),
                      if (_image != null) ...[
                        const SizedBox(height: AppTokens.space16),
                        Image.memory(
                          Uint8List.fromList(_image!),
                          key: const Key('admin-receipt-image'),
                          height: 220,
                          fit: BoxFit.contain,
                          frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
                            if (wasSynchronouslyLoaded || frame != null) {
                              _scheduleImageResult(true);
                            }
                            return child;
                          },
                          errorBuilder: (context, error, stackTrace) {
                            _scheduleImageResult(false);
                            return const Text(
                              'تصویر فیش قابل نمایش نیست.',
                              key: Key('admin-receipt-image-error'),
                            );
                          },
                        ),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: AppTokens.space12),
                        Text(_decisionError(_error!)),
                      ],
                      if (review.phase == 'UNDER_REVIEW') ...[
                        const SizedBox(height: AppTokens.space16),
                        CheckboxListTile(
                          key: const Key('activation-bank-attestation'),
                          value: _attested,
                          onChanged: _busy || !_imageReady || _renderFailed
                              ? null
                              : (value) => setState(() => _attested = value ?? false),
                          contentPadding: EdgeInsets.zero,
                          controlAffinity: ListTileControlAffinity.leading,
                          title: Text(
                            review.requiredBankAttestation,
                            key: const Key('activation-bank-attestation-text'),
                          ),
                        ),
                        const SizedBox(height: AppTokens.space8),
                        AppButton(
                          key: const Key('activation-approve'),
                          label: 'فعال‌سازی',
                          loading: _busy,
                          onPressed: _busy ||
                                  !_imageReady ||
                                  _renderFailed ||
                                  !_attested ||
                                  _image == null ||
                                  review.requiredBankAttestation.isEmpty
                              ? null
                              : _approve,
                        ),
                        const SizedBox(height: AppTokens.space8),
                        OutlinedButton(
                          key: const Key('activation-reject'),
                          onPressed: _busy ? null : _reject,
                          child: const Text('عدم فعال‌سازی'),
                        ),
                      ],
                    ],
                  ),
      ),
    );
  }
}

class _RejectDialog extends StatefulWidget {
  const _RejectDialog();

  @override
  State<_RejectDialog> createState() => _RejectDialogState();
}

class _RejectDialogState extends State<_RejectDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ready = _reason.text.trim().length >= 3;
    return AlertDialog(
      title: const Text('عدم فعال‌سازی'),
      content: TextField(
        key: const Key('activation-reject-reason'),
        controller: _reason,
        onChanged: (_) => setState(() {}),
        decoration: const InputDecoration(labelText: 'دلیل'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('انصراف')),
        TextButton(
          key: const Key('activation-reject-confirm'),
          onPressed: ready ? () => Navigator.pop(context, _reason.text.trim()) : null,
          child: const Text('ثبت'),
        ),
      ],
    );
  }
}

class _Failure extends StatelessWidget {
  const _Failure({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final failure = error;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(failure is ApiException ? failure.message : 'فهرست فیش‌ها خوانده نشد.'),
          TextButton(onPressed: onRetry, child: const Text('تلاش دوباره')),
        ],
      ),
    );
  }
}

String _decisionError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return 'تصمیم ثبت نشد.';
}

String _phaseLabel(String phase) {
  return switch (phase) {
    'UNDER_REVIEW' => 'در انتظار بررسی',
    'APPROVED' => 'فعال شده',
    'REJECTED' => 'فعال نشده',
    _ => phase,
  };
}

String _when(String? iso) {
  if (iso == null || iso.isEmpty) {
    return '';
  }
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) {
    return iso;
  }
  return formatJalaliDateTime(parsed.toLocal());
}
