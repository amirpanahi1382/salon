import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import 'signup_otp_panel.dart';

class PasswordRecoveryScreen extends ConsumerStatefulWidget {
  const PasswordRecoveryScreen({
    super.key,
    this.now = DateTime.now,
    this.keyFactory = createRequestId,
  });

  final DateTime Function() now;
  final String Function() keyFactory;

  @override
  ConsumerState<PasswordRecoveryScreen> createState() =>
      _PasswordRecoveryScreenState();
}

class _PasswordRecoveryScreenState extends ConsumerState<PasswordRecoveryScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  String? _error;
  String? _proof;
  String? _startKey;
  String? _startPhone;
  bool _startAmbiguous = false;
  String? _completeKey;
  bool _completeAmbiguous = false;
  bool _loading = false;
  bool _available = false;
  bool _availabilityLoaded = false;
  int _step = 0;
  DateTime? _codeDeadline;
  DateTime? _resendDeadline;
  int _otpGeneration = 0;

  @override
  void initState() {
    super.initState();
    _loadAvailability();
  }

  Future<void> _loadAvailability() async {
    final available =
        await ref.read(authRepositoryProvider).passwordRecoveryAvailable();
    if (!mounted) {
      return;
    }
    setState(() {
      _available = available;
      _availabilityLoaded = true;
    });
  }

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (!_available) {
      setState(() => _error = AppStrings.passwordRecoveryUnavailable);
      return;
    }
    final retry = _startAmbiguous && _startKey != null && _startPhone != null;
    final phone = retry ? _startPhone! : _phone.text.trim();
    if (phone.isEmpty) {
      setState(() => _error = AppStrings.enterPhonePassword);
      return;
    }
    final key = retry ? _startKey! : widget.keyFactory();
    final requestStartedAt = widget.now();
    setState(() {
      _loading = true;
      _error = null;
      if (!retry) {
        _startKey = key;
        _startPhone = phone;
        _startAmbiguous = false;
      }
    });
    try {
      final challenge = await ref
          .read(authRepositoryProvider)
          .startPasswordRecovery(phone: phone, idempotencyKey: key);
      if (mounted) {
        final responseAt = widget.now();
        setState(() {
          _startAmbiguous = false;
          _startKey = null;
          _proof = null;
          _codeDeadline = requestStartedAt.add(
            Duration(seconds: challenge.expiresInSeconds),
          );
          _resendDeadline = responseAt.add(
            Duration(seconds: challenge.resendAvailableInSeconds),
          );
          _otpGeneration += 1;
          _step = 1;
        });
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      final ambiguous = isSignupErrorAmbiguous(error);
      setState(() {
        _startAmbiguous = ambiguous;
        if (!ambiguous) {
          _startKey = null;
        }
        _error = friendlyError(error);
      });
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _setPassword() async {
    final phone = _startPhone ?? _phone.text.trim();
    final proof = _proof;
    if (proof == null) {
      setState(() => _error = AppStrings.enterSignupCode);
      return;
    }
    if (_password.text.length < 8) {
      setState(() => _error = AppStrings.enterPhonePassword);
      return;
    }
    if (_password.text != _confirmation.text) {
      setState(() => _error = AppStrings.passwordMismatch);
      return;
    }
    final retry = _completeAmbiguous && _completeKey != null;
    final key = retry ? _completeKey! : widget.keyFactory();
    setState(() {
      _loading = true;
      _error = null;
      if (!retry) {
        _completeKey = key;
        _completeAmbiguous = false;
      }
    });
    try {
      await ref.read(authRepositoryProvider).completePasswordRecovery(
            phone: phone,
            recoveryProof: proof,
            password: _password.text,
            passwordConfirmation: _confirmation.text,
            idempotencyKey: key,
          );
      if (mounted) {
        setState(() {
          _completeAmbiguous = false;
          _completeKey = null;
          _step = 3;
        });
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      final ambiguous = isSignupErrorAmbiguous(error);
      setState(() {
        _completeAmbiguous = ambiguous;
        if (!ambiguous) {
          _completeKey = null;
        }
        _error = friendlyError(error);
      });
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.forgotPasswordTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (!_availabilityLoaded)
              const SizedBox(height: 24)
            else if (!_available) ...[
              const Text(AppStrings.passwordRecoveryUnavailable),
              const SizedBox(height: 24),
              AppButton(
                label: AppStrings.signIn,
                onPressed: () => context.go('/login'),
              ),
            ] else if (_step == 0) ...[
              AppTextField(
                key: const Key('recovery-phone'),
                label: AppStrings.mobileNumber,
                controller: _phone,
                keyboardType: TextInputType.phone,
                textDirection: TextDirection.ltr,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 24),
              AppButton(
                label: AppStrings.sendRecoveryCode,
                onPressed: _sendCode,
                loading: _loading,
              ),
            ] else if (_step == 1 &&
                _codeDeadline != null &&
                _resendDeadline != null) ...[
              SignupOtpPanel(
                key: ValueKey('recovery-otp-$_otpGeneration'),
                phone: _startPhone ?? _phone.text.trim(),
                expiresAt: _codeDeadline!,
                resendAvailableAt: _resendDeadline!,
                repository: ref.read(authRepositoryProvider),
                heading: AppStrings.recoveryOtpHeading,
                now: widget.now,
                keyFactory: widget.keyFactory,
                startChallenge: ({required phone, required idempotencyKey}) {
                  return ref.read(authRepositoryProvider).startPasswordRecovery(
                        phone: phone,
                        idempotencyKey: idempotencyKey,
                      );
                },
                verifyChallenge: ({
                  required phone,
                  required otpCode,
                  required idempotencyKey,
                }) {
                  return ref.read(authRepositoryProvider).verifyPasswordRecovery(
                        phone: phone,
                        otpCode: otpCode,
                        idempotencyKey: idempotencyKey,
                      );
                },
                onVerified: (proof) {
                  setState(() {
                    _proof = proof;
                    _step = 2;
                    _error = null;
                  });
                },
                onResendConfirmed: () {
                  setState(() {
                    _proof = null;
                    _error = null;
                  });
                },
              ),
            ] else if (_step == 2) ...[
              AppTextField(
                key: const Key('recovery-password'),
                label: AppStrings.newPassword,
                controller: _password,
                obscureText: true,
                textDirection: TextDirection.ltr,
              ),
              const SizedBox(height: 12),
              AppTextField(
                key: const Key('recovery-password-confirmation'),
                label: AppStrings.confirmPassword,
                controller: _confirmation,
                obscureText: true,
                textDirection: TextDirection.ltr,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 24),
              AppButton(
                label: AppStrings.setNewPassword,
                onPressed: _setPassword,
                loading: _loading,
              ),
            ] else ...[
              const Text(AppStrings.passwordResetDone),
              const SizedBox(height: 24),
              AppButton(
                label: AppStrings.signIn,
                onPressed: () => context.go('/login'),
              ),
            ],
            TextButton(
              onPressed: () => context.go('/login'),
              child: const Text(AppStrings.haveAccount),
            ),
          ],
        ),
      ),
    );
  }
}
