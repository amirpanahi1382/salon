import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'admin_messaging_shell.dart';

class AdminMessageStopsScreen extends ConsumerStatefulWidget {
  const AdminMessageStopsScreen({super.key});

  @override
  ConsumerState<AdminMessageStopsScreen> createState() => _AdminMessageStopsScreenState();
}

class _AdminMessageStopsScreenState extends ConsumerState<AdminMessageStopsScreen> {
  final _phone = TextEditingController();
  PlatformMessageStop? _stop;
  Object? _error;
  bool _busy = false;
  bool _searched = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final stop = await ref.read(adminMessageRepositoryProvider).findStop(_phone.text);
      if (!mounted) return;
      setState(() {
        _stop = stop;
        _searched = true;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _busy = false;
      });
    }
  }

  Future<bool> _confirm(String title, String body) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(AppStrings.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(title),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _register() async {
    if (!await _confirm(AppStrings.adminStopMessages, AppStrings.adminStopMessagesBody)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final stop = await ref.read(adminMessageRepositoryProvider).registerStop(_phone.text);
      if (!mounted) return;
      setState(() {
        _stop = stop;
        _searched = true;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _busy = false;
      });
    }
  }

  Future<void> _lift() async {
    if (!await _confirm(AppStrings.adminLiftStop, AppStrings.adminLiftStopBody)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final stop = await ref.read(adminMessageRepositoryProvider).liftStop(_phone.text);
      if (!mounted) return;
      setState(() {
        _stop = stop;
        _searched = true;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final stop = _stop;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(title: const Text(AppStrings.adminMessageStops)),
        body: ListView(
          padding: const EdgeInsets.all(AppTokens.space16),
          children: [
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: AppStrings.adminStopSearch),
            ),
            const SizedBox(height: AppTokens.space12),
            AppButton(
              label: AppStrings.adminStopSearch,
              loading: _busy,
              onPressed: _busy ? null : _search,
            ),
            if (_error != null) ...[
              const SizedBox(height: AppTokens.space12),
              Text(friendlyError(_error!)),
            ],
            if (_searched && stop == null) ...[
              const SizedBox(height: AppTokens.space16),
              const Text(AppStrings.adminStopNone),
            ],
            if (stop != null) ...[
              const SizedBox(height: AppTokens.space16),
              Text(stop.active ? AppStrings.adminStopActive : AppStrings.adminLiftStop),
              Text(stop.registeredAt.toLocal().toString()),
              Text(
                '${AppStrings.adminStopResult} ${stop.blockedRequestCount} / ${stop.skippedRecipientCount}',
              ),
            ],
            const SizedBox(height: AppTokens.space16),
            AppButton(
              label: AppStrings.adminStopMessages,
              onPressed: _busy ? null : _register,
            ),
            const SizedBox(height: AppTokens.space8),
            AppButton(
              label: AppStrings.adminLiftStop,
              onPressed: _busy ? null : _lift,
            ),
          ],
        ),
      ),
    );
  }
}
