import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/onboarding_progress.dart';
import '../../shared/labels.dart';
import 'signup_otp_panel.dart';

String loginErrorText(Object error) => friendlyError(error);

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: LoadingView());
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _loading = false;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final phone = _phone.text.trim();
    final password = _password.text;
    if (phone.isEmpty || password.isEmpty) {
      setState(() => _error = AppStrings.enterPhonePassword);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).loginWithPhone(phone, password);
    } catch (error) {
      setState(() => _error = loginErrorText(error));
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.loginTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              AppStrings.appName,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            const Text(AppStrings.attentionQuestion),
            const SizedBox(height: 32),
            AppTextField(
              key: const Key('login-phone'),
              label: AppStrings.mobileNumber,
              controller: _phone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
            ),
            const SizedBox(height: 12),
            AppTextField(
              key: const Key('login-password'),
              label: AppStrings.password,
              controller: _password,
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
              label: AppStrings.signIn,
              onPressed: _submit,
              loading: _loading,
            ),
            TextButton(
              onPressed: () => context.go('/register'),
              child: const Text(AppStrings.needAccount),
            ),
          ],
        ),
      ),
    );
  }
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({
    super.key,
    this.now = DateTime.now,
    this.keyFactory = createRequestId,
  });

  final DateTime Function() now;
  final String Function() keyFactory;

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _phone = TextEditingController();
  final _salon = TextEditingController();
  final _owner = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  String? _error;
  String? _proof;
  String? _startKey;
  String? _startPhone;
  bool _startAmbiguous = false;
  String? _completeKey;
  _SignupCompletion? _completeBody;
  bool _completeAmbiguous = false;
  bool _loading = false;
  int _step = 0;
  DateTime? _codeDeadline;
  DateTime? _resendDeadline;
  int _otpGeneration = 0;

  @override
  void dispose() {
    _phone.dispose();
    _salon.dispose();
    _owner.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final retry = _startAmbiguous && _startKey != null && _startPhone != null;
    final phone = retry ? _startPhone! : _phone.text.trim();
    if (phone.isEmpty) {
      setState(() => _error = AppStrings.enterPhonePassword);
      return;
    }
    final key = retry ? _startKey! : widget.keyFactory();
    // Code validity is anchored to request start so transit delay cannot make
    // the UI show a still-valid code after the server deadline. Resend wait
    // uses the response clock so the button does not unlock early.
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
      final challenge = await ref.read(authRepositoryProvider).startPhoneSignup(
            phone: phone,
            idempotencyKey: key,
          );
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
      if (mounted) {
        setState(() {
          _startAmbiguous = isSignupErrorAmbiguous(error);
          if (!_startAmbiguous) {
            _startKey = null;
          }
          _error = loginErrorText(error);
        });
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  void _onVerified(String proof) {
    if (!mounted) {
      return;
    }
    setState(() {
      _proof = proof;
      _error = null;
      _step = 2;
    });
  }

  void _onResendConfirmed() {
    if (!mounted) {
      return;
    }
    setState(() {
      _proof = null;
      _completeKey = null;
      _completeBody = null;
      _completeAmbiguous = false;
      _error = null;
    });
  }

  void _restartOtpForExpiredProof() {
    final now = widget.now();
    setState(() {
      _proof = null;
      _step = 1;
      _codeDeadline = now;
      _resendDeadline = now;
      _otpGeneration += 1;
      _error = AppStrings.signupProofExpired;
    });
  }

  Future<void> _createAccount() async {
    final retry =
        _completeAmbiguous && _completeKey != null && _completeBody != null;
    final body = retry
        ? _completeBody!
        : _SignupCompletion(
            phone: _phone.text.trim(),
            proof: _proof ?? '',
            salonName: _salon.text.trim(),
            ownerName: _owner.text.trim(),
            password: _password.text,
            passwordConfirmation: _confirmation.text,
          );
    if (!retry) {
      if (body.salonName.isEmpty ||
          body.ownerName.isEmpty ||
          body.password.length < 8) {
        setState(() => _error = AppStrings.registerValidation);
        return;
      }
      if (body.password != body.passwordConfirmation) {
        setState(() => _error = AppStrings.passwordMismatch);
        return;
      }
      if (body.proof.isEmpty) {
        setState(() => _error = AppStrings.enterSignupCode);
        return;
      }
    }
    final key = retry ? _completeKey! : widget.keyFactory();
    setState(() {
      _loading = true;
      _error = null;
      if (!retry) {
        _completeKey = key;
        _completeBody = body;
        _completeAmbiguous = false;
      }
    });
    try {
      await ref.read(authRepositoryProvider).completePhoneSignup(
            phone: body.phone,
            signupProof: body.proof,
            salonName: body.salonName,
            ownerName: body.ownerName,
            password: body.password,
            passwordConfirmation: body.passwordConfirmation,
            idempotencyKey: key,
          );
      await ref.read(authControllerProvider.notifier).loginWithPhone(
            body.phone,
            body.password,
          );
      if (mounted) {
        setState(() {
          _completeAmbiguous = false;
          _completeKey = null;
        });
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (error is ApiException && error.code == 'SIGNUP_PROOF_EXPIRED') {
        setState(() => _loading = false);
        _restartOtpForExpiredProof();
        return;
      }
      setState(() {
        _completeAmbiguous = isSignupErrorAmbiguous(error);
        if (!_completeAmbiguous) {
          _completeKey = null;
        }
        _error = loginErrorText(error);
      });
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final otpStep = _step == 1;
    return Scaffold(
      backgroundColor: otpStep ? SignupOtpVisuals.background : null,
      appBar: AppBar(
        title: Text(
          AppStrings.registerTitle,
          style: otpStep
              ? const TextStyle(
                  color: SignupOtpVisuals.text,
                  fontWeight: FontWeight.w600,
                )
              : null,
        ),
        backgroundColor: otpStep ? SignupOtpVisuals.background : null,
        foregroundColor: otpStep ? SignupOtpVisuals.text : null,
        elevation: otpStep ? 0 : null,
        scrolledUnderElevation: otpStep ? 0 : null,
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                AppTokens.space24,
                otpStep ? AppTokens.space8 : AppTokens.space24,
                AppTokens.space24,
                AppTokens.space24 + MediaQuery.viewInsetsOf(context).bottom,
              ),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Directionality(
                    textDirection: TextDirection.rtl,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (!otpStep) ...[
                          const OnboardingProgress(
                            stage: OnboardingStage.registration,
                          ),
                          const SizedBox(height: AppTokens.space20),
                        ],
                        if (_step == 0)
                          AppTextField(
                            key: const Key('signup-phone'),
                            label: AppStrings.mobileNumber,
                            controller: _phone,
                            keyboardType: TextInputType.phone,
                            textDirection: TextDirection.ltr,
                          ),
                        if (_step == 1 &&
                            _codeDeadline != null &&
                            _resendDeadline != null)
                          SignupOtpPanel(
                            key: ValueKey('signup-otp-$_otpGeneration'),
                            phone: _startPhone ?? _phone.text.trim(),
                            expiresAt: _codeDeadline!,
                            resendAvailableAt: _resendDeadline!,
                            repository: ref.read(authRepositoryProvider),
                            now: widget.now,
                            keyFactory: widget.keyFactory,
                            onVerified: _onVerified,
                            onResendConfirmed: _onResendConfirmed,
                          ),
                        if (_step == 2) ...[
                          AppTextField(
                            key: const Key('signup-salon'),
                            label: AppStrings.salonName,
                            controller: _salon,
                          ),
                          const SizedBox(height: 12),
                          AppTextField(
                            key: const Key('signup-owner'),
                            label: AppStrings.ownerName,
                            controller: _owner,
                          ),
                          const SizedBox(height: 12),
                          AppTextField(
                            key: const Key('signup-password'),
                            label: AppStrings.password,
                            controller: _password,
                            obscureText: true,
                            textDirection: TextDirection.ltr,
                          ),
                          const SizedBox(height: 12),
                          AppTextField(
                            key: const Key('signup-password-confirmation'),
                            label: AppStrings.confirmPassword,
                            controller: _confirmation,
                            obscureText: true,
                            textDirection: TextDirection.ltr,
                          ),
                        ],
                        if (_error != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            _error!,
                            key: const Key('signup-error'),
                            style: TextStyle(
                              color: otpStep
                                  ? SignupOtpVisuals.danger
                                  : Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ],
                        if (_step != 1) ...[
                          const SizedBox(height: AppTokens.space24),
                          AppButton(
                            key: const Key('signup-submit'),
                            label: _step == 0
                                ? AppStrings.sendSignupCode
                                : AppStrings.createAccount,
                            onPressed:
                                _step == 0 ? _sendCode : _createAccount,
                            loading: _loading,
                          ),
                          TextButton(
                            onPressed: () => context.go('/login'),
                            child: const Text(AppStrings.haveAccount),
                          ),
                        ] else
                          TextButton(
                            onPressed: () => context.go('/login'),
                            style: TextButton.styleFrom(
                              foregroundColor: SignupOtpVisuals.textMuted,
                            ),
                            child: const Text(AppStrings.haveAccount),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _SignupCompletion {
  const _SignupCompletion({
    required this.phone,
    required this.proof,
    required this.salonName,
    required this.ownerName,
    required this.password,
    required this.passwordConfirmation,
  });

  final String phone;
  final String proof;
  final String salonName;
  final String ownerName;
  final String password;
  final String passwordConfirmation;
}
