import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/routing/app_router.dart';
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

class _AdminActivationReceiptsScreenState extends ConsumerState<AdminActivationReceiptsScreen>
    with RouteAware {
  ActivationReceiptFilter _filter = ActivationReceiptFilter.all;
  List<ActivationReceiptSummary> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _cursor;
  Object? _error;
  Object? _loadMoreError;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route is PageRoute) {
      adminRouteObserver.subscribe(this, route);
    }
  }

  @override
  void dispose() {
    adminRouteObserver.unsubscribe(this);
    super.dispose();
  }

  @override
  void didPopNext() {
    // Returning from a pushed receipt detail after approve, reject, or back.
    _load();
  }

  void _selectFilter(ActivationReceiptFilter filter) {
    if (_filter == filter) return;
    setState(() => _filter = filter);
    _load();
  }

  Future<void> _load({bool append = false}) async {
    final generation = ++_generation;
    setState(() {
      _error = null;
      _loadMoreError = null;
      if (append) {
        _loadingMore = true;
      } else {
        _loading = true;
        _loadingMore = false;
        _items = [];
        _hasMore = false;
        _cursor = null;
      }
    });
    try {
      final page = await ref
          .read(activationRepositoryProvider)
          .list(filter: _filter, cursor: append ? _cursor : null);
      if (!mounted || generation != _generation) return;
      setState(() {
        _items = append ? [..._items, ...page.items] : page.items;
        _hasMore = page.hasMore;
        _cursor = page.nextCursor;
        _loading = false;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        if (append) {
          _loadMoreError = error;
        } else {
          _error = error;
        }
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(activationReceiptListRefreshProvider, (previous, next) {
      if (previous != next) {
        _load();
      }
    });
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(title: const Text(AppStrings.adminActivationReceipts)),
        body: Column(
          children: [
            SizedBox(
              width: double.infinity,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: AppTokens.space16),
                child: Row(
                  children: [
                    for (final filter in ActivationReceiptFilter.values) ...[
                      ChoiceChip(
                        key: Key(_filterKey(filter)),
                        label: Text(filter.label),
                        selected: _filter == filter,
                        onSelected: (_) => _selectFilter(filter),
                      ),
                      if (filter != ActivationReceiptFilter.values.last)
                        const SizedBox(width: AppTokens.space8),
                    ],
                  ],
                ),
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const LoadingView();
    }
    if (_items.isEmpty) {
      if (_error != null) {
        return _Failure(error: _error!, onRetry: () => _load());
      }
      return EmptyStateView(
        title: _emptyTitle,
        body: 'وقتی صاحب سالن فیش واریز را ارسال کند، اینجا دیده می‌شود.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(AppTokens.space16),
      itemCount: _items.length + (_hasMore ? 1 : 0),
      separatorBuilder: (_, _) => const SizedBox(height: AppTokens.space12),
      itemBuilder: (context, index) {
        if (index == _items.length) {
          if (_loadMoreError != null) {
            return Column(
              children: [
                const Text(
                  'بارگذاری ادامه فیش‌ها ناموفق بود.',
                  key: Key('activation-load-more-error'),
                ),
                const SizedBox(height: AppTokens.space8),
                OutlinedButton(
                  key: const Key('activation-load-more-retry'),
                  onPressed: _loadingMore ? null : () => _load(append: true),
                  child: const Text('تلاش دوباره'),
                ),
              ],
            );
          }
          return OutlinedButton(
            key: const Key('activation-load-more'),
            onPressed: _loadingMore ? null : () => _load(append: true),
            child: Text(_loadingMore ? 'در حال بارگذاری…' : 'بیشتر'),
          );
        }
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
    );
  }

  String get _emptyTitle {
    return switch (_filter) {
      ActivationReceiptFilter.all => 'فیشی ثبت نشده است.',
      ActivationReceiptFilter.underReview => 'فیشی در انتظار بررسی نیست.',
      ActivationReceiptFilter.approved => 'فیش تأییدشده‌ای نیست.',
      ActivationReceiptFilter.rejected => 'فیش ردشده‌ای نیست.',
    };
  }
}

String _filterKey(ActivationReceiptFilter filter) {
  return switch (filter) {
    ActivationReceiptFilter.all => 'activation-filter-all',
    ActivationReceiptFilter.underReview => 'activation-filter-under-review',
    ActivationReceiptFilter.approved => 'activation-filter-approved',
    ActivationReceiptFilter.rejected => 'activation-filter-rejected',
  };
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
      ref.read(activationReceiptListRefreshProvider.notifier).bump();
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
      ref.read(activationReceiptListRefreshProvider.notifier).bump();
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
                  if (review.decidedAt != null)
                    Text(
                      'زمان تصمیم: ${_when(review.decidedAt)}',
                      key: const Key('admin-receipt-decided-at'),
                    ),
                  if (review.bankAttestationWording != null &&
                      review.bankAttestationWording!.isNotEmpty)
                    Text(
                      'متن تأیید بانکی: ${review.bankAttestationWording}',
                      key: const Key('admin-receipt-attestation'),
                    ),
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
                      onPressed:
                          _busy ||
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
    'APPROVED' => 'تأیید شده',
    'REJECTED' => 'رد شده',
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
