import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/networking/repositories.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';

const _codePattern = r'^\d{4,8}$';
const _codeMaxLength = 8;

/// Dark OTP visuals aligned with app chrome; orange accents from the reference.
abstract final class SignupOtpVisuals {
  static const Color background = AppTokens.bg;
  static const Color surface = AppTokens.surfaceElevated;
  static const Color orange = Color(0xFFE8A23A);
  static const Color orangeDeep = Color(0xFFD4891F);
  static const Color orangeSoft = Color(0xFF4A3A22);
  static const Color boxIdle = Color(0xFF2A2622);
  static const Color text = AppTokens.textPrimary;
  static const Color textMuted = AppTokens.textSecondary;
  static const Color danger = AppTokens.danger;
  static const Color success = AppTokens.success;
  static const Color onOrange = Color(0xFF1A1612);
}

/// Shows four slots initially, then one per typed digit up to the server's
/// eight-digit ceiling. Snapping to 6/8 made a five-digit code look unfinished.
int signupOtpVisibleSlotCount(int digitCount) {
  if (digitCount < 4) {
    return 4;
  }
  return digitCount > _codeMaxLength ? _codeMaxLength : digitCount;
}

String formatSignupCountdown(int seconds) {
  final safe = seconds < 0 ? 0 : seconds;
  final minutes = (safe ~/ 60).toString().padLeft(2, '0');
  final remainder = (safe % 60).toString().padLeft(2, '0');
  return toPersianDigits('$minutes:$remainder');
}

String normalizeSignupCode(String value) {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  final buffer = StringBuffer();
  for (final rune in value.runes) {
    final character = String.fromCharCode(rune);
    final persianIndex = persian.indexOf(character);
    if (persianIndex >= 0) {
      buffer.write(persianIndex);
      continue;
    }
    final arabicIndex = arabic.indexOf(character);
    if (arabicIndex >= 0) {
      buffer.write(arabicIndex);
      continue;
    }
    buffer.write(character);
  }
  return buffer.toString().trim();
}

bool isSignupErrorAmbiguous(Object error) {
  if (error is NetworkException) {
    return true;
  }
  if (error is ApiException) {
    return error.statusCode >= 500 ||
        error.code == 'SIGNUP_SEND_UNCONFIRMED' ||
        error.code == 'SIGNUP_VERIFICATION_UNCONFIRMED';
  }
  return false;
}

class SignupOtpPanel extends StatefulWidget {
  const SignupOtpPanel({
    super.key,
    required this.phone,
    required this.expiresAt,
    required this.resendAvailableAt,
    required this.repository,
    required this.onVerified,
    this.onResendConfirmed,
    this.now = DateTime.now,
    this.keyFactory = createRequestId,
  });

  final String phone;
  final DateTime expiresAt;
  final DateTime resendAvailableAt;
  final AuthRepository repository;
  final ValueChanged<String> onVerified;
  final VoidCallback? onResendConfirmed;
  final DateTime Function() now;
  final String Function() keyFactory;

  @override
  State<SignupOtpPanel> createState() => _SignupOtpPanelState();
}

class _SignupOtpPanelState extends State<SignupOtpPanel>
    with WidgetsBindingObserver {
  final _code = TextEditingController();
  final _focus = FocusNode();
  Timer? _ticker;
  late DateTime _codeDeadline;
  late DateTime _resendDeadline;
  late int _codeSeconds;
  late int _resendSeconds;
  bool _verifying = false;
  bool _resending = false;
  bool _attemptsExhausted = false;
  String? _error;
  String? _info;
  String? _resendKey;
  bool _resendAmbiguous = false;
  String? _verifyKey;
  String? _verifyPhone;
  String? _verifyCodeValue;
  bool _verifyAmbiguous = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _focus.addListener(() {
      if (mounted) {
        setState(() {});
      }
    });
    _codeDeadline = widget.expiresAt;
    _resendDeadline = widget.resendAvailableAt;
    _codeSeconds = _secondsUntil(_codeDeadline);
    _resendSeconds = _secondsUntil(_resendDeadline);
    _startTicker();
  }

  @override
  void didUpdateWidget(covariant SignupOtpPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.phone != widget.phone ||
        oldWidget.expiresAt != widget.expiresAt ||
        oldWidget.resendAvailableAt != widget.resendAvailableAt) {
      _codeDeadline = widget.expiresAt;
      _resendDeadline = widget.resendAvailableAt;
      _codeSeconds = _secondsUntil(_codeDeadline);
      _resendSeconds = _secondsUntil(_resendDeadline);
      _startTicker();
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _focus.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _tick();
      _startTicker();
      return;
    }
    _ticker?.cancel();
    _ticker = null;
  }

  int _secondsUntil(DateTime deadline) {
    final milliseconds = deadline.difference(widget.now()).inMilliseconds;
    if (milliseconds <= 0) {
      return 0;
    }
    return (milliseconds / 1000).ceil();
  }

  void _startTicker() {
    if (_codeSeconds == 0 && _resendSeconds == 0) {
      _ticker?.cancel();
      _ticker = null;
      return;
    }
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    if (!mounted) {
      return;
    }
    final codeSeconds = _secondsUntil(_codeDeadline);
    final resendSeconds = _secondsUntil(_resendDeadline);
    final justExpired = codeSeconds == 0 && _codeSeconds > 0;
    setState(() {
      _codeSeconds = codeSeconds;
      _resendSeconds = resendSeconds;
      if (justExpired) {
        _applyExpiredCodeState();
      } else if (codeSeconds == 0) {
        // Keep verify bookkeeping cleared while the code stays expired.
        _verifyKey = null;
        _verifyPhone = null;
        _verifyCodeValue = null;
        _verifyAmbiguous = false;
      }
    });
    if (codeSeconds == 0 && resendSeconds == 0) {
      _ticker?.cancel();
      _ticker = null;
    }
  }

  /// Single expired-code UI: no obsolete digits and no stale verify error.
  void _applyExpiredCodeState() {
    _codeDeadline = widget.now();
    _codeSeconds = 0;
    _code.clear();
    _verifyKey = null;
    _verifyPhone = null;
    _verifyCodeValue = null;
    _verifyAmbiguous = false;
    _error = null;
    _info = null;
  }

  bool get _codeExpired => _codeSeconds == 0;

  bool get _canResend => _resendSeconds == 0 && !_resending && !_verifying;

  bool get _canVerify =>
      !_verifying &&
      !_codeExpired &&
      !_attemptsExhausted &&
      !_resending &&
      RegExp(_codePattern).hasMatch(normalizeSignupCode(_code.text));

  void _applyRetryAfter(Object error) {
    if (error is! ApiException) {
      return;
    }
    final seconds = error.retryAfterSeconds;
    if (seconds == null) {
      return;
    }
    final candidate = widget.now().add(Duration(seconds: seconds));
    if (candidate.isAfter(_resendDeadline)) {
      _resendDeadline = candidate;
      _resendSeconds = _secondsUntil(_resendDeadline);
      _startTicker();
    }
  }

  void _onCodeEdited(String _) {
    if (_verifyAmbiguous &&
        _verifyCodeValue != null &&
        normalizeSignupCode(_code.text) != _verifyCodeValue) {
      // Keep the visible input aligned with the pending ambiguous retry so the
      // user does not think a different code will be submitted.
      _code.value = TextEditingValue(
        text: _verifyCodeValue!,
        selection: TextSelection.collapsed(offset: _verifyCodeValue!.length),
      );
      setState(() {
        _error = AppStrings.signupVerificationUnconfirmed;
        _info = null;
      });
      return;
    }
    // Rebuild digit segments (4/6/8) and clear stale status when the code changes.
    setState(() {
      _error = null;
      _info = null;
    });
  }

  Future<void> _resend() async {
    if (!_canResend) {
      return;
    }
    final retry = _resendAmbiguous && _resendKey != null;
    final key = retry ? _resendKey! : widget.keyFactory();
    // Anchor code validity to request start so network delay cannot extend the
    // UI past the server's remaining lifetime. Resend availability stays on the
    // response clock so the button does not unlock early.
    final requestStartedAt = widget.now();
    setState(() {
      _resending = true;
      _error = null;
      _info = null;
      if (!retry) {
        _resendKey = key;
        _resendAmbiguous = false;
      }
    });
    try {
      final challenge = await widget.repository.startPhoneSignup(
        phone: widget.phone,
        idempotencyKey: key,
      );
      if (!mounted) {
        return;
      }
      final responseAt = widget.now();
      setState(() {
        _resendKey = null;
        _resendAmbiguous = false;
        _codeDeadline = requestStartedAt.add(
          Duration(seconds: challenge.expiresInSeconds),
        );
        _resendDeadline = responseAt.add(
          Duration(seconds: challenge.resendAvailableInSeconds),
        );
        _codeSeconds = _secondsUntil(_codeDeadline);
        _resendSeconds = _secondsUntil(_resendDeadline);
        _code.clear();
        _verifyKey = null;
        _verifyPhone = null;
        _verifyCodeValue = null;
        _verifyAmbiguous = false;
        _attemptsExhausted = false;
        _error = null;
        _info = AppStrings.signupCodeSentAgain;
      });
      widget.onResendConfirmed?.call();
      _startTicker();
    } catch (error) {
      if (!mounted) {
        return;
      }
      final ambiguous = isSignupErrorAmbiguous(error);
      setState(() {
        _resendAmbiguous = ambiguous;
        if (!ambiguous) {
          _resendKey = null;
        }
        _error = friendlyError(error);
        _applyRetryAfter(error);
      });
    } finally {
      if (mounted) {
        setState(() => _resending = false);
      }
    }
  }

  Future<void> _verify() async {
    if (_verifying) {
      return;
    }
    if (_codeExpired) {
      setState(() => _error = AppStrings.signupCodeExpired);
      return;
    }
    final retry =
        _verifyAmbiguous &&
        _verifyKey != null &&
        _verifyPhone == widget.phone &&
        _verifyCodeValue != null;
    if (retry) {
      _code.value = TextEditingValue(
        text: _verifyCodeValue!,
        selection: TextSelection.collapsed(offset: _verifyCodeValue!.length),
      );
    }
    final code = retry ? _verifyCodeValue! : normalizeSignupCode(_code.text);
    if (!RegExp(_codePattern).hasMatch(code)) {
      setState(() => _error = AppStrings.signupOtpCodeMalformed);
      return;
    }
    final key = retry ? _verifyKey! : widget.keyFactory();
    setState(() {
      _verifying = true;
      _error = null;
      _info = null;
      if (!retry) {
        _verifyKey = key;
        _verifyPhone = widget.phone;
        _verifyCodeValue = code;
        _verifyAmbiguous = false;
      }
    });
    try {
      final proof = await widget.repository.verifyPhoneSignup(
        phone: widget.phone,
        otpCode: code,
        idempotencyKey: key,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _verifyKey = null;
        _verifyCodeValue = null;
        _verifyAmbiguous = false;
      });
      widget.onVerified(proof);
    } catch (error) {
      if (!mounted) {
        return;
      }
      // Re-read the deadline after the await. A late failure must not paint a
      // wrong-code message over the expired-code guidance.
      final expiredDuringRequest = _secondsUntil(_codeDeadline) == 0;
      final ambiguous = isSignupErrorAmbiguous(error);
      setState(() {
        if (expiredDuringRequest ||
            (error is ApiException &&
                error.code == 'SIGNUP_CHALLENGE_EXPIRED')) {
          _applyExpiredCodeState();
          if (error is ApiException) {
            if (error.code == 'SIGNUP_VERIFICATION_LIMIT') {
              _attemptsExhausted = true;
            }
            _applyRetryAfter(error);
          }
          return;
        }
        _verifyAmbiguous = ambiguous;
        if (!ambiguous) {
          _verifyKey = null;
          _verifyCodeValue = null;
        } else if (_verifyCodeValue != null) {
          _code.value = TextEditingValue(
            text: _verifyCodeValue!,
            selection: TextSelection.collapsed(
              offset: _verifyCodeValue!.length,
            ),
          );
        }
        _error = friendlyError(error);
        if (error is ApiException) {
          if (error.code == 'SIGNUP_VERIFICATION_LIMIT') {
            _attemptsExhausted = true;
            _verifyKey = null;
            _verifyPhone = null;
            _verifyCodeValue = null;
            _verifyAmbiguous = false;
          }
          if (error.code == 'SIGNUP_CHALLENGE_SUPERSEDED') {
            // Expire the obsolete challenge but keep the superseded next step.
            _codeDeadline = widget.now();
            _codeSeconds = 0;
            _code.clear();
            _verifyKey = null;
            _verifyPhone = null;
            _verifyCodeValue = null;
            _verifyAmbiguous = false;
            _attemptsExhausted = false;
          }
          _applyRetryAfter(error);
        }
      });
    } finally {
      if (mounted) {
        setState(() => _verifying = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final codeTime = formatSignupCountdown(_codeSeconds);
    final resendTime = formatSignupCountdown(_resendSeconds);
    final expiredMessage = _resendSeconds > 0
        ? AppStrings.signupCodeExpiredWait
        : AppStrings.signupCodeExpired;
    final digits = normalizeSignupCode(_code.text);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 150),
        padding: EdgeInsets.only(bottom: bottomInset > 0 ? 8 : 0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SignupOtpHeroIllustration(
              key: Key('signup-otp-illustration'),
            ),
            const SizedBox(height: AppTokens.space20),
            Semantics(
              header: true,
              child: Text(
                AppStrings.signupOtpHeading,
                key: const Key('signup-otp-heading'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: SignupOtpVisuals.text,
                  fontSize: 26,
                  height: 1.25,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: AppTokens.space8),
            Text(
              AppStrings.signupOtpDestination(
                toPersianDigits(maskCustomerPhone(widget.phone)),
              ),
              key: const Key('signup-otp-explanation'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: SignupOtpVisuals.textMuted,
                fontSize: 14,
                height: 1.45,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: AppTokens.space24),
            _buildDigitBoxes(digits),
            const SizedBox(height: AppTokens.space16),
            _buildCountdownResendRow(codeTime, resendTime),
            if (_codeExpired) ...[
              const SizedBox(height: AppTokens.space8),
              Text(
                expiredMessage,
                key: const Key('signup-code-expired'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: SignupOtpVisuals.danger,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ],
            if (_info != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(
                _info!,
                key: const Key('signup-otp-info'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: SignupOtpVisuals.success,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: AppTokens.space8),
              Text(
                _error!,
                key: const Key('signup-otp-error'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: SignupOtpVisuals.danger,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ],
            const SizedBox(height: AppTokens.space24),
            SizedBox(
              height: 52,
              child: FilledButton(
                key: const Key('signup-verify'),
                onPressed: _canVerify ? _verify : null,
                style: FilledButton.styleFrom(
                  backgroundColor: SignupOtpVisuals.orange,
                  disabledBackgroundColor: SignupOtpVisuals.orange.withValues(
                    alpha: 0.4,
                  ),
                  foregroundColor: SignupOtpVisuals.onOrange,
                  disabledForegroundColor: SignupOtpVisuals.onOrange.withValues(
                    alpha: 0.85,
                  ),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(26),
                  ),
                ),
                child: _verifying
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: SignupOtpVisuals.onOrange,
                        ),
                      )
                    : const Text(
                        AppStrings.verifySignupCode,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCountdownResendRow(String codeTime, String resendTime) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          flex: 4,
          child: Semantics(
            label: '${AppStrings.signupCodeValidity} $codeTime',
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: AlignmentDirectional.centerStart,
                child: Text(
                  '${AppStrings.signupCodeValidity} $codeTime',
                  key: const Key('signup-code-countdown'),
                  style: TextStyle(
                    color: _codeExpired
                        ? SignupOtpVisuals.danger
                        : SignupOtpVisuals.textMuted,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: AppTokens.space8),
        Expanded(
          flex: 6,
          child: TextButton(
            key: const Key('signup-resend'),
            onPressed: _canResend ? _resend : null,
            style: TextButton.styleFrom(
              foregroundColor: SignupOtpVisuals.orange,
              disabledForegroundColor: SignupOtpVisuals.orange.withValues(
                alpha: 0.45,
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space8,
                vertical: AppTokens.space4,
              ),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              alignment: AlignmentDirectional.centerEnd,
            ),
            child: _resending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: SignupOtpVisuals.orange,
                    ),
                  )
                : FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: AlignmentDirectional.centerEnd,
                    child: Text(
                      _resendSeconds > 0
                          ? AppStrings.signupResendRemaining(resendTime)
                          : AppStrings.signupResendCode,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
          ),
        ),
      ],
    );
  }

  Widget _buildDigitBoxes(String digits) {
    final slotCount = signupOtpVisibleSlotCount(digits.length);
    return Semantics(
      key: const Key('signup-code-semantics'),
      label: AppStrings.signupOtpCodeLabel,
      value: digits.isEmpty ? null : toPersianDigits(digits),
      hint: '۴ تا ۸ رقم',
      textField: true,
      excludeSemantics: true,
      onTap: () {
        if (!_verifying) {
          _focus.requestFocus();
        }
      },
      child: Column(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () {
              if (!_verifying) {
                _focus.requestFocus();
              }
            },
            child: Directionality(
              textDirection: TextDirection.ltr,
              child: Row(
                children: List.generate(slotCount, (index) {
                  final filled = index < digits.length;
                  final active =
                      _focus.hasFocus &&
                      !_verifying &&
                      index == digits.length.clamp(0, slotCount - 1);
                  final hasError = _error != null;
                  final borderColor = hasError
                      ? SignupOtpVisuals.danger
                      : (active
                            ? SignupOtpVisuals.orange
                            : (filled
                                  ? SignupOtpVisuals.orangeDeep
                                  : SignupOtpVisuals.boxIdle));
                  return Expanded(
                    child: Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: index == 0 ? 0 : 6,
                        end: index == slotCount - 1 ? 0 : 6,
                      ),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 120),
                        height: 56,
                        alignment: Alignment.center,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          color: SignupOtpVisuals.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: borderColor,
                            width: active ? 2 : 1.25,
                          ),
                        ),
                        child: filled
                            ? Text(
                                toPersianDigits(digits[index]),
                                style: const TextStyle(
                                  color: SignupOtpVisuals.text,
                                  fontSize: 22,
                                  fontWeight: FontWeight.w700,
                                  fontFeatures: [FontFeature.tabularFigures()],
                                ),
                              )
                            : const SizedBox.shrink(),
                      ),
                    ),
                  );
                }),
              ),
            ),
          ),
          // Off-layout field keeps paste/autofill/keyboard without painting a
          // Material underline, cursor, or selection handle across the row.
          Transform.translate(
            offset: const Offset(-2000, 0),
            child: SizedBox(
              height: 0,
              width: 0,
              child: TextField(
                key: const Key('signup-code'),
                controller: _code,
                focusNode: _focus,
                autofocus: true,
                enabled: !_verifying,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                textDirection: TextDirection.ltr,
                showCursor: false,
                cursorWidth: 0,
                selectionControls: emptyTextSelectionControls,
                enableInteractiveSelection: true,
                autocorrect: false,
                enableSuggestions: false,
                autofillHints: const [AutofillHints.oneTimeCode],
                maxLength: _codeMaxLength,
                buildCounter: (
                  context, {
                  required currentLength,
                  required isFocused,
                  required maxLength,
                }) => null,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩]')),
                  LengthLimitingTextInputFormatter(_codeMaxLength),
                ],
                onChanged: _onCodeEdited,
                onSubmitted: (_) {
                  if (_canVerify) {
                    _verify();
                  }
                },
                style: const TextStyle(
                  color: Colors.transparent,
                  fontSize: 1,
                  height: 0.01,
                ),
                cursorColor: Colors.transparent,
                decoration: const InputDecoration.collapsed(hintText: null),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SignupOtpHeroIllustration extends StatelessWidget {
  const _SignupOtpHeroIllustration({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 132,
      child: CustomPaint(
        painter: _SignupOtpHeroPainter(),
        child: const Center(),
      ),
    );
  }
}

class _SignupOtpHeroPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final orange = Paint()..color = SignupOtpVisuals.orange;
    final soft = Paint()..color = SignupOtpVisuals.orangeSoft;
    final screen = Paint()..color = AppTokens.bg;
    final deep = Paint()..color = SignupOtpVisuals.orangeDeep;
    final dot = Paint()..color = SignupOtpVisuals.onOrange;
    final cx = size.width / 2;
    final cy = size.height / 2 + 6;

    canvas.drawOval(
      Rect.fromCenter(center: Offset(cx, cy + 50), width: 128, height: 20),
      soft,
    );

    final head = Offset(cx - 18, cy - 42);
    canvas.drawCircle(head, 14, orange);
    final hair = Path()
      ..moveTo(head.dx - 14, head.dy - 2)
      ..quadraticBezierTo(head.dx - 22, head.dy + 18, head.dx - 8, head.dy + 28)
      ..quadraticBezierTo(head.dx - 18, head.dy + 8, head.dx - 12, head.dy - 6)
      ..close();
    canvas.drawPath(hair, deep);
    final torso = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset(cx - 18, cy + 18), width: 46, height: 58),
      const Radius.circular(18),
    );
    canvas.drawRRect(torso, orange);

    final phone = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset(cx + 10, cy + 4), width: 48, height: 78),
      const Radius.circular(10),
    );
    canvas.drawRRect(phone, deep);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(cx + 10, cy + 8), width: 38, height: 60),
        const Radius.circular(6),
      ),
      screen,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(cx + 10, cy - 28), width: 14, height: 3),
        const Radius.circular(1.5),
      ),
      soft,
    );

    final leftBubble = RRect.fromRectAndRadius(
      Rect.fromLTWH(cx - 108, cy - 34, 50, 30),
      const Radius.circular(12),
    );
    canvas.drawRRect(leftBubble, orange);
    canvas.drawCircle(Offset(cx - 94, cy - 22), 2.0, dot);
    canvas.drawCircle(Offset(cx - 84, cy - 22), 2.0, dot);
    canvas.drawCircle(Offset(cx - 74, cy - 22), 2.0, dot);

    final rightBubble = RRect.fromRectAndRadius(
      Rect.fromLTWH(cx + 48, cy - 6, 54, 32),
      const Radius.circular(12),
    );
    canvas.drawRRect(rightBubble, orange);
    canvas.drawCircle(Offset(cx + 62, cy + 6), 2.0, dot);
    canvas.drawCircle(Offset(cx + 74, cy + 6), 2.0, dot);
    canvas.drawCircle(Offset(cx + 86, cy + 6), 2.0, dot);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
