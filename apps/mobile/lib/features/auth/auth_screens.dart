import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/onboarding_progress.dart';
import '../../shared/labels.dart';

String loginErrorText(Object error) {
  final friendly = friendlyError(error);
  if (kDebugMode) {
    if (error is ApiException) {
      return 'HTTP ${error.statusCode} ${error.code}\n${error.message}\n$friendly';
    }
    if (error is NetworkException) {
      return 'NetworkException: ${error.message}';
    }
    return '${error.runtimeType}: $error\n$friendly';
  }
  return friendly;
}

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
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _salon = TextEditingController();
  final _owner = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  String? _error;
  String? _proof;
  String? _startKey;
  String? _startPhone;
  bool _startAmbiguous = false;
  String? _verifyKey;
  String? _verifyPhone;
  String? _verifyCodeValue;
  bool _verifyAmbiguous = false;
  String? _completeKey;
  _SignupCompletion? _completeBody;
  bool _completeAmbiguous = false;
  bool _loading = false;
  int _step = 0;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _salon.dispose();
    _owner.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  bool _ambiguous(Object error) {
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

  Future<void> _sendCode() async {
    final retry = _startAmbiguous && _startKey != null && _startPhone != null;
    final phone = retry ? _startPhone! : _phone.text.trim();
    if (phone.isEmpty) {
      setState(() => _error = AppStrings.enterPhonePassword);
      return;
    }
    final key = retry ? _startKey! : createRequestId();
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
      await ref.read(authRepositoryProvider).startPhoneSignup(
            phone: phone,
            idempotencyKey: key,
          );
      if (mounted) {
        setState(() {
          _startAmbiguous = false;
          _startKey = null;
          _step = 1;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _startAmbiguous = _ambiguous(error);
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

  Future<void> _verifyCode() async {
    final retry = _verifyAmbiguous &&
        _verifyKey != null &&
        _verifyPhone != null &&
        _verifyCodeValue != null;
    final phone = retry ? _verifyPhone! : _phone.text.trim();
    final code = retry ? _verifyCodeValue! : _code.text.trim();
    if (!RegExp(r'^\d{4,8}$').hasMatch(code)) {
      setState(() => _error = AppStrings.enterSignupCode);
      return;
    }
    final key = retry ? _verifyKey! : createRequestId();
    setState(() {
      _loading = true;
      _error = null;
      if (!retry) {
        _verifyKey = key;
        _verifyPhone = phone;
        _verifyCodeValue = code;
        _verifyAmbiguous = false;
      }
    });
    try {
      final proof = await ref.read(authRepositoryProvider).verifyPhoneSignup(
            phone: phone,
            otpCode: code,
            idempotencyKey: key,
          );
      if (mounted) {
        setState(() {
          _proof = proof;
          _verifyAmbiguous = false;
          _verifyKey = null;
          _step = 2;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _verifyAmbiguous = _ambiguous(error);
          if (!_verifyAmbiguous) {
            _verifyKey = null;
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
    final key = retry ? _completeKey! : createRequestId();
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
      if (mounted) {
        setState(() {
          _completeAmbiguous = _ambiguous(error);
          if (!_completeAmbiguous) {
            _completeKey = null;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.registerTitle)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const OnboardingProgress(stage: OnboardingStage.registration),
          const SizedBox(height: 20),
          if (_step == 0)
            AppTextField(
              key: const Key('signup-phone'),
              label: AppStrings.mobileNumber,
              controller: _phone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
            ),
          if (_step == 1)
            AppTextField(
              key: const Key('signup-code'),
              label: AppStrings.signupCode,
              controller: _code,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
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
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 24),
          AppButton(
            key: const Key('signup-submit'),
            label: _step == 0
                ? AppStrings.sendSignupCode
                : _step == 1
                    ? AppStrings.verifySignupCode
                    : AppStrings.createAccount,
            onPressed: _step == 0
                ? _sendCode
                : _step == 1
                    ? _verifyCode
                    : _createAccount,
            loading: _loading,
          ),
          TextButton(
            onPressed: () => context.go('/login'),
            child: const Text(AppStrings.haveAccount),
          ),
        ],
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
