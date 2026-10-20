import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/onboarding_progress.dart';
import 'agreement_repository.dart';
import 'contract_markdown.dart';
import 'contract_presentation.dart';
import 'declared_fields.dart';

final agreementRepositoryProvider = Provider<AgreementRepository>((ref) {
  return AgreementRepository(ref.watch(apiClientProvider));
});

const agreementPhoneUnverifiedText =
    'این شماره با شمارهٔ تأییدشدهٔ حساب یکسان نیست. برای استفاده از شمارهٔ جدید باید دوباره تأیید شود.';

const agreementDeclaredNote =
    'نام، کد ملی، نام سالن و اختیار انعقاد قرارداد اعلام شماست و به‌صورت مستقل احراز نشده است.';

const agreementRecordedText = 'قرارداد ثبت شد. راهنمای واریز هنوز در دسترس نیست.';

const agreementJumpToConsentLabel = 'رفتن به تأیید';

/// Same green as the contract title; used for the fixed bottom jump control.
const agreementTitleGreen = Color(0xFF81C784);
const agreementJumpGreen = agreementTitleGreen;
const agreementJumpGreenForeground = Color(0xFF1B5E20);
const agreementJumpBarHeight = 52.0;

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
  final _scrollController = ScrollController();
  final _consentSectionKey = GlobalKey();
  final _confirmButtonKey = GlobalKey();
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
  bool _presentationAmbiguous = false;
  String? _fullNameError;
  String? _nationalIdError;
  String? _salonNameError;

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
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _jumpToConsent() async {
    FocusManager.instance.primaryFocus?.unfocus();
    await _waitForKeyboardToClose();
    if (!mounted) {
      return;
    }
    await _revealConsentControls(const Duration(milliseconds: 350));
    if (!mounted) {
      return;
    }
    // A preview can arrive between measuring and scrolling; correct once the
    // list has settled so one tap still lands on both controls.
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) {
      return;
    }
    await _revealConsentControls(const Duration(milliseconds: 120));
  }

  Future<void> _waitForKeyboardToClose() async {
    for (var attempt = 0; attempt < 10; attempt += 1) {
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted) {
        return;
      }
      if (MediaQuery.viewInsetsOf(context).bottom == 0) {
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 40));
    }
  }

  Future<void> _revealConsentControls(Duration duration) async {
    if (!mounted || !_scrollController.hasClients) {
      return;
    }
    final consent = _consentSectionKey.currentContext;
    final confirm = _confirmButtonKey.currentContext;
    if (consent == null || confirm == null) {
      return;
    }
    final consentBox = consent.findRenderObject();
    final confirmBox = confirm.findRenderObject();
    if (consentBox is! RenderBox || confirmBox is! RenderBox) {
      return;
    }
    final viewport = RenderAbstractViewport.of(consentBox);
    if (viewport is! RenderBox) {
      return;
    }
    final viewportBox = viewport as RenderBox;
    final viewportTop = viewportBox.localToGlobal(Offset.zero).dy;
    final consentTop = consentBox.localToGlobal(Offset.zero).dy - viewportTop;
    final confirmBottom = confirmBox.localToGlobal(Offset.zero).dy +
        confirmBox.size.height -
        viewportTop;
    const gap = 8.0;
    final targetForConsent = consentTop - gap;
    final targetForConfirm = confirmBottom - (viewportBox.size.height - gap);
    // Show the checkbox top when both controls fit above the fixed bar;
    // otherwise keep the confirmation control clear of the bar.
    final bothFit =
        confirmBottom - targetForConsent <= viewportBox.size.height - gap;
    final delta = bothFit ? targetForConsent : targetForConfirm;
    if (delta.abs() < 0.5) {
      return;
    }
    final position = _scrollController.position;
    final target = (position.pixels + delta).clamp(
      position.minScrollExtent,
      position.maxScrollExtent,
    );
    await _scrollController.animateTo(
      target,
      duration: duration,
      curve: Curves.easeInOut,
    );
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _presentationAmbiguous = false;
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
    final fullName = validateDeclaredFullName(_fullName.text);
    final nationalId = validateDeclaredNationalId(_nationalId.text);
    final salonName = validateDeclaredSalonName(_salonName.text);
    setState(() {
      _preview = null;
      _accepted = false;
      _previewing = false;
      _fullNameError = _fullName.text.trim().isEmpty ? null : fullName.error;
      _nationalIdError = _nationalId.text.trim().isEmpty ? null : nationalId.error;
      _salonNameError = _salonName.text.trim().isEmpty ? null : salonName.error;
    });
    _refreshPreview(generation);
  }

  void _onNationalIdChanged(String value) {
    final ascii = toAsciiDigits(value).replaceAll(RegExp(r'\s'), '');
    if (ascii != _nationalId.text) {
      final selection = ascii.length;
      _nationalId.value = TextEditingValue(
        text: ascii,
        selection: TextSelection.collapsed(offset: selection.clamp(0, ascii.length)),
      );
    }
    _edit();
  }

  bool _phoneNeedsVerification(AgreementContract contract) {
    final phone = _phone.text.trim();
    return phone.isNotEmpty && phone != contract.verifiedPhone;
  }

  bool _declaredFieldsValid() {
    return validateDeclaredFullName(_fullName.text).isValid &&
        validateDeclaredNationalId(_nationalId.text).isValid &&
        validateDeclaredSalonName(_salonName.text).isValid;
  }

  bool _fieldsReady(AgreementContract contract) {
    return !_phoneNeedsVerification(contract) &&
        _declaredFieldsValid() &&
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
                : _presentationAmbiguous
                    ? _ErrorPane(
                        error: 'نمایش قرارداد برای این نسخه مبهم است.',
                        onRetry: _load,
                      )
                    : _buildContractPage(context, contract),
      ),
    );
  }

  Widget _buildContractPage(BuildContext context, AgreementContract contract) {
    final consentEnabled = _preview != null &&
        !_previewing &&
        _declaredFieldsValid() &&
        !_phoneNeedsVerification(contract);
    // Extra list padding keeps consent + confirm fully above the fixed jump bar.
    const listBottomPadding = agreementJumpBarHeight + 48;
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: OnboardingProgress(stage: OnboardingStage.agreement),
        ),
        Expanded(
          child: SingleChildScrollView(
            key: const Key('agreement-scroll'),
            controller: _scrollController,
            padding: const EdgeInsets.fromLTRB(24, 16, 24, listBottomPadding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  contract.versionKey == contractV1VersionKey
                      ? contractV1Title
                      : contract.versionKey,
                  key: const Key('agreement-title'),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: agreementTitleGreen,
                        fontWeight: FontWeight.w700,
                      ),
                ),
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
                  ..._previewWidgets(contract, _preview!),
                ],
                const SizedBox(height: 16),
                KeyedSubtree(
                  key: _consentSectionKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      CheckboxListTile(
                        key: const Key('agreement-consent'),
                        contentPadding: EdgeInsets.zero,
                        value: consentEnabled && _accepted,
                        onChanged: !consentEnabled
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
                      KeyedSubtree(
                        key: _confirmButtonKey,
                        child: AppButton(
                          key: const Key('agreement-confirm'),
                          label: contract.buttonWording,
                          loading: _submitting || _previewing,
                          onPressed: consentEnabled && _accepted ? _submit : null,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        Material(
          color: agreementJumpGreen,
          elevation: 6,
          child: SizedBox(
            height: agreementJumpBarHeight,
            width: double.infinity,
            child: TextButton(
              key: const Key('agreement-jump-to-consent'),
              onPressed: _jumpToConsent,
              style: TextButton.styleFrom(
                foregroundColor: agreementJumpGreenForeground,
                minimumSize: const Size(double.infinity, agreementJumpBarHeight),
                padding: EdgeInsets.zero,
                shape: const RoundedRectangleBorder(),
              ),
              child: const Text(
                agreementJumpToConsentLabel,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _previewWidgets(AgreementContract contract, AgreementPreview preview) {
    final prepared = prepareContractPresentation(
      versionKey: contract.versionKey,
      source: preview.canonicalDocument,
      checkboxWording: contract.checkboxWording,
      buttonWording: contract.buttonWording,
    );
    if (prepared == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_presentationAmbiguous) {
          setState(() => _presentationAmbiguous = true);
        }
      });
      return const [];
    }
    return [
      ContractMarkdownView(
        key: const Key('agreement-rendered'),
        source: prepared.body,
      ),
    ];
  }

  List<Widget> _body(AgreementContract contract) {
    final widgets = <Widget>[];
    final segments = contract.segments;
    for (var index = 0; index < segments.length; index += 1) {
      final segment = segments[index];
      if (segment.text != null) {
        final nextField =
            index + 1 < segments.length ? segments[index + 1].field : null;
        final prepared = prepareContractPresentation(
          versionKey: contract.versionKey,
          source: segment.text!,
          checkboxWording: contract.checkboxWording,
          buttonWording: contract.buttonWording,
          stripTrailingFieldLabelFor: nextField,
        );
        if (prepared == null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && !_presentationAmbiguous) {
              setState(() => _presentationAmbiguous = true);
            }
          });
          return widgets;
        }
        if (prepared.body.trim().isEmpty) {
          continue;
        }
        widgets.add(
          ContractMarkdownView(
            key: Key('agreement-readonly-$index'),
            source: prepared.body,
          ),
        );
      } else {
        widgets.add(_field(segment.field ?? ''));
      }
    }
    return widgets;
  }

  Widget _field(String field) {
    final child = switch (field) {
      'fullName' => AppTextField(
          key: const Key('agreement-full-name'),
          label: 'نام و نام خانوادگی',
          controller: _fullName,
          hintOnly: true,
          errorText: _fullNameError,
          onChanged: (_) => _edit(),
        ),
      'nationalId' => AppTextField(
          key: const Key('agreement-national-id'),
          label: 'کد ملی',
          controller: _nationalId,
          hintOnly: true,
          errorText: _nationalIdError,
          keyboardType: TextInputType.number,
          textDirection: TextDirection.ltr,
          maxLength: 10,
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩]')),
          ],
          onChanged: _onNationalIdChanged,
        ),
      'salonName' => AppTextField(
          key: const Key('agreement-salon-name'),
          label: 'نام سالن آرایشگاهی',
          controller: _salonName,
          hintOnly: true,
          errorText: _salonNameError,
          onChanged: (_) => _edit(),
        ),
      _ => AppTextField(
          key: const Key('agreement-phone'),
          label: 'شمارهٔ تماس',
          controller: _phone,
          hintOnly: true,
          readOnly: true,
          keyboardType: TextInputType.phone,
          textDirection: TextDirection.ltr,
        ),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: child,
    );
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
                  const OnboardingProgress(stage: OnboardingStage.activation),
                  const SizedBox(height: 12),
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
    final message = failure is ApiException
        ? failure.message
        : failure is String
            ? failure
            : 'بارگذاری قرارداد ناموفق بود.';
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
