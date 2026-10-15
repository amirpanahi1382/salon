import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import 'agreement_repository.dart';

final agreementRepositoryProvider = Provider<AgreementRepository>((ref) {
  return AgreementRepository(ref.watch(apiClientProvider));
});

const agreementPhoneUnverifiedText =
    'این شماره با شمارهٔ تأییدشدهٔ حساب یکسان نیست. برای استفاده از شمارهٔ جدید باید دوباره تأیید شود.';

const agreementDeclaredNote =
    'نام، کد ملی، نام سالن و اختیار انعقاد قرارداد اعلام شماست و به‌صورت مستقل احراز نشده است.';

const agreementRecordedText = 'قرارداد ثبت شد. راهنمای واریز هنوز در دسترس نیست.';

class AgreementScreen extends ConsumerStatefulWidget {
  const AgreementScreen({super.key});

  @override
  ConsumerState<AgreementScreen> createState() => _AgreementScreenState();
}

class _AgreementScreenState extends ConsumerState<AgreementScreen> {
  final _fullName = TextEditingController();
  final _nationalId = TextEditingController();
  final _salonName = TextEditingController();
  final _phone = TextEditingController();
  AgreementContract? _contract;
  AgreementPreview? _preview;
  Object? _error;
  bool _loading = true;
  bool _previewing = false;
  bool _submitting = false;
  bool _accepted = false;
  String? _idempotencyKey;
  int _previewGeneration = 0;
  _AcceptanceAttempt? _pendingAcceptance;
  bool _acceptRetry = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _fullName.dispose();
    _nationalId.dispose();
    _salonName.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final contract = await ref.read(agreementRepositoryProvider).current();
      if (!mounted) return;
      _phone.text = contract.verifiedPhone;
      setState(() {
        _contract = contract;
        _loading = false;
      });
      await _refreshPreview();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  void _edit() {
    final generation = ++_previewGeneration;
    _idempotencyKey = createRequestId();
    _pendingAcceptance = null;
    _acceptRetry = false;
    setState(() {
      _preview = null;
      _accepted = false;
      _previewing = false;
    });
    _refreshPreview(generation);
  }

  bool _phoneNeedsVerification(AgreementContract contract) {
    final phone = _phone.text.trim();
    return phone.isNotEmpty && phone != contract.verifiedPhone;
  }

  bool _fieldsReady(AgreementContract contract) {
    return !_phoneNeedsVerification(contract) &&
        _fullName.text.trim().isNotEmpty &&
        _nationalId.text.trim().isNotEmpty &&
        _salonName.text.trim().isNotEmpty &&
        _phone.text.trim().isNotEmpty;
  }

  Future<void> _refreshPreview([int? generation]) async {
    final requestGeneration = generation ?? ++_previewGeneration;
    final contract = _contract;
    final fullName = _fullName.text.trim();
    final nationalId = _nationalId.text.trim();
    final salonName = _salonName.text.trim();
    final phone = _phone.text.trim();
    if (contract == null || !_fieldsReady(contract)) {
      if (!mounted || requestGeneration != _previewGeneration) return;
      setState(() {
        _preview = null;
        _previewing = false;
        _accepted = false;
      });
      return;
    }
    setState(() => _previewing = true);
    try {
      final preview = await ref.read(agreementRepositoryProvider).present(
            fullName: fullName,
            nationalId: nationalId,
            salonName: salonName,
            phone: phone,
          );
      if (!mounted || requestGeneration != _previewGeneration) return;
      if (_fullName.text.trim() != fullName ||
          _nationalId.text.trim() != nationalId ||
          _salonName.text.trim() != salonName ||
          _phone.text.trim() != phone) {
        return;
      }
      if (_pendingAcceptance != null) {
        _idempotencyKey = createRequestId();
      }
      _pendingAcceptance = null;
      _acceptRetry = false;
      setState(() {
        _preview = preview;
        _previewing = false;
        _accepted = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted || requestGeneration != _previewGeneration) return;
      setState(() {
        _preview = null;
        _accepted = false;
        _previewing = false;
        _acceptRetry = false;
        _error = error;
      });
    }
  }

  bool _sameAttempt(AgreementPreview preview, _AcceptanceAttempt pending) {
    return preview.presentationId == pending.presentationId &&
        preview.canonicalDocument == pending.canonicalDocument &&
        _idempotencyKey == pending.idempotencyKey;
  }

  bool get _canRetryAcceptance {
    final pending = _pendingAcceptance;
    final preview = _preview;
    final contract = _contract;
    return _acceptRetry &&
        pending != null &&
        preview != null &&
        contract != null &&
        _accepted &&
        !_previewing &&
        !_phoneNeedsVerification(contract) &&
        _sameAttempt(preview, pending);
  }

  Future<void> _submit() async {
    final preview = _preview;
    final contract = _contract;
    if (!_accepted || preview == null || contract == null || _submitting || _previewing) {
      return;
    }
    if (_phoneNeedsVerification(contract)) {
      return;
    }
    final pending = _pendingAcceptance;
    final reusable = pending != null && _sameAttempt(preview, pending) ? pending : null;
    final key = reusable?.idempotencyKey ?? (_idempotencyKey ??= createRequestId());
    final attempt = _AcceptanceAttempt(
      presentationId: preview.presentationId,
      idempotencyKey: key,
      canonicalDocument: preview.canonicalDocument,
    );
    _pendingAcceptance = attempt;
    _idempotencyKey = key;
    setState(() {
      _submitting = true;
      _error = null;
      _acceptRetry = false;
    });
    try {
      final result = await ref.read(agreementRepositoryProvider).accept(
            presentationId: attempt.presentationId,
            idempotencyKey: attempt.idempotencyKey,
          );
      if (!mounted) return;
      _pendingAcceptance = null;
      _acceptRetry = false;
      ref.read(authControllerProvider.notifier).noteAccessState(result.accessState);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _acceptRetry = _ambiguousAcceptanceFailure(error);
      });
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final contract = _contract;
    return Scaffold(
      body: SafeArea(
        child: _loading
            ? const LoadingView()
            : contract == null
                ? _ErrorPane(error: _error, onRetry: _load)
                : ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text('نسخه ${contract.versionKey}', key: const Key('agreement-version')),
                      const SizedBox(height: 8),
                      Text(contract.amountLabel, key: const Key('agreement-amount')),
                      Text(contract.amountIrr, key: const Key('agreement-amount-irr')),
                      const SizedBox(height: 12),
                      const Text(agreementDeclaredNote, key: Key('agreement-declared-note')),
                      const SizedBox(height: 12),
                      ..._body(contract),
                      if (_phoneNeedsVerification(contract))
                        const Padding(
                          padding: EdgeInsets.only(top: 12),
                          child: Text(
                            agreementPhoneUnverifiedText,
                            key: Key('agreement-phone-unverified'),
                          ),
                        ),
                      if (_preview != null) ...[
                        const SizedBox(height: 16),
                        const Text('متن نهایی همین نسخه'),
                        Text(_preview!.canonicalDocument, key: const Key('agreement-rendered')),
                      ],
                      const SizedBox(height: 16),
                      CheckboxListTile(
                        key: const Key('agreement-consent'),
                        contentPadding: EdgeInsets.zero,
                        value: _preview != null && !_previewing && _accepted,
                        onChanged: _preview == null || _previewing || _phoneNeedsVerification(contract)
                            ? null
                            : (value) => setState(() => _accepted = value ?? false),
                        title: Text(contract.checkboxWording),
                        controlAffinity: ListTileControlAffinity.leading,
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(_message(_error!), key: const Key('agreement-error')),
                        TextButton(
                          key: const Key('agreement-retry'),
                          onPressed: _retry,
                          child: const Text('تلاش دوباره'),
                        ),
                      ],
                      const SizedBox(height: 12),
                      AppButton(
                        key: const Key('agreement-confirm'),
                        label: contract.buttonWording,
                        loading: _submitting || _previewing,
                        onPressed: _accepted &&
                                _preview != null &&
                                !_previewing &&
                                !_phoneNeedsVerification(contract)
                            ? _submit
                            : null,
                      ),
                    ],
                  ),
      ),
    );
  }

  List<Widget> _body(AgreementContract contract) {
    final widgets = <Widget>[];
    for (var index = 0; index < contract.segments.length; index += 1) {
      final segment = contract.segments[index];
      if (segment.text != null) {
        widgets.add(Text(segment.text!, key: Key('agreement-readonly-$index')));
      } else {
        widgets.add(_field(segment.field ?? ''));
      }
    }
    return widgets;
  }

  Widget _field(String field) {
    return switch (field) {
      'fullName' => AppTextField(
          key: const Key('agreement-full-name'),
          label: 'نام و نام خانوادگی',
          controller: _fullName,
          onChanged: (_) => _edit(),
        ),
      'nationalId' => AppTextField(
          key: const Key('agreement-national-id'),
          label: 'کد ملی',
          controller: _nationalId,
          keyboardType: TextInputType.number,
          textDirection: TextDirection.ltr,
          onChanged: (_) => _edit(),
        ),
      'salonName' => AppTextField(
          key: const Key('agreement-salon-name'),
          label: 'نام سالن آرایشگاهی',
          controller: _salonName,
          onChanged: (_) => _edit(),
        ),
      _ => AppTextField(
          key: const Key('agreement-phone'),
          label: 'شمارهٔ تماس',
          controller: _phone,
          keyboardType: TextInputType.phone,
          textDirection: TextDirection.ltr,
          onChanged: (_) => _edit(),
        ),
    };
  }

  Future<void> _retry() async {
    if (_contract == null) {
      await _load();
      return;
    }
    if (_canRetryAcceptance) {
      await _submit();
      return;
    }
    await _refreshPreview();
  }

  String _message(Object error) {
    if (error is ApiException && error.code == 'AGREEMENT_PHONE_UNVERIFIED') {
      return agreementPhoneUnverifiedText;
    }
    if (error is ApiException) {
      return error.message;
    }
    return 'بارگذاری قرارداد ناموفق بود.';
  }
}

class AgreementRecordedScreen extends ConsumerStatefulWidget {
  const AgreementRecordedScreen({super.key});

  @override
  ConsumerState<AgreementRecordedScreen> createState() => _AgreementRecordedScreenState();
}

class _AgreementRecordedScreenState extends ConsumerState<AgreementRecordedScreen> {
  AgreementReceipt? _receipt;
  Object? _error;
  bool _loading = true;

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
      final receipt = await ref.read(agreementRepositoryProvider).receipt();
      if (!mounted) return;
      setState(() {
        _receipt = receipt;
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

  String _recordedError(Object error) {
    if (error is ApiException) {
      return error.message;
    }
    return 'رسید قرارداد بارگذاری نشد.';
  }

  @override
  Widget build(BuildContext context) {
    final receipt = _receipt;
    return Scaffold(
      body: SafeArea(
        child: _loading
            ? const LoadingView()
            : ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  const Text(agreementRecordedText, key: Key('agreement-recorded')),
                  if (receipt != null) ...[
                    const SizedBox(height: 16),
                    Text(receipt.versionKey, key: const Key('agreement-receipt-version')),
                    Text(receipt.acceptedAt, key: const Key('agreement-receipt-time')),
                    Text(receipt.renderedDigest, key: const Key('agreement-receipt-digest')),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _recordedError(_error!),
                      key: const Key('agreement-recorded-error'),
                    ),
                    TextButton(
                      key: const Key('agreement-recorded-retry'),
                      onPressed: _load,
                      child: const Text('تلاش دوباره'),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

class _AcceptanceAttempt {
  const _AcceptanceAttempt({
    required this.presentationId,
    required this.idempotencyKey,
    required this.canonicalDocument,
  });

  final String presentationId;
  final String idempotencyKey;
  final String canonicalDocument;
}

bool _ambiguousAcceptanceFailure(Object error) {
  if (error is NetworkException) {
    return true;
  }
  if (error is ApiException) {
    return error.statusCode >= 500;
  }
  return true;
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({required this.error, required this.onRetry});

  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final failure = error;
    final message = failure is ApiException ? failure.message : 'بارگذاری قرارداد ناموفق بود.';
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          message,
          key: const Key('agreement-error'),
        ),
        TextButton(
          key: const Key('agreement-retry'),
          onPressed: onRetry,
          child: const Text('تلاش دوباره'),
        ),
      ],
    );
  }
}
