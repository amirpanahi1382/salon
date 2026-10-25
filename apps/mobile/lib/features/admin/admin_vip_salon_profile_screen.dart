import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'admin_messaging_shell.dart';

class AdminVipSalonProfileScreen extends ConsumerStatefulWidget {
  const AdminVipSalonProfileScreen({super.key, required this.salonId});

  final String salonId;

  @override
  ConsumerState<AdminVipSalonProfileScreen> createState() =>
      _AdminVipSalonProfileScreenState();
}

class _AdminVipSalonProfileScreenState
    extends ConsumerState<AdminVipSalonProfileScreen> {
  AdminSalonProfile? _profile;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final profile =
          await ref.read(vipRepositoryProvider).adminSalonProfile(widget.salonId);
      if (!mounted) return;
      setState(() => _profile = profile);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  Future<void> _confirmToggle() async {
    final profile = _profile;
    if (profile == null || _busy) return;
    final enable = !profile.entitled;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          enable
              ? AppStrings.adminVipEnableConfirmTitle
              : AppStrings.adminVipDisableConfirmTitle,
        ),
        content: Text(
          enable
              ? AppStrings.adminVipEnableConfirmBody(profile.salonName)
              : AppStrings.adminVipDisableConfirmBody(profile.salonName),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              enable ? AppStrings.adminVipEnable : AppStrings.adminVipDisable,
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final key = createRequestId();
      if (enable) {
        await ref.read(vipRepositoryProvider).grantEntitlement(profile.salonId, key);
      } else {
        await ref.read(vipRepositoryProvider).revokeEntitlement(profile.salonId, key);
      }
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            enable ? AppStrings.adminVipEnabled : AppStrings.adminVipDisabled,
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(error))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;
    return AdminMessagingShell(
      child: Scaffold(
        appBar: AppBar(
          title: Text(profile?.salonName ?? AppStrings.adminVipSalonProfileTitle),
          leading: IconButton(
            onPressed: () => context.go('/admin/vip/salons'),
            icon: const Icon(Icons.arrow_back),
          ),
        ),
        body: _error != null && profile == null
            ? ErrorView(message: friendlyError(_error!), onRetry: _load)
            : profile == null
                ? const LoadingSkeleton(lines: 8)
                : ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      Text(
                        profile.entitled
                            ? AppStrings.vipActive
                            : AppStrings.vipInactive,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: AppTokens.space8),
                      Text(AppStrings.adminVipLiveRead),
                      Text(
                        'به‌روز تا ${formatJalaliDateTime(profile.asOf)}',
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                      const SizedBox(height: AppTokens.space16),
                      _CountTile(
                        key: const ValueKey('admin-vip-profile-distinct'),
                        label: AppStrings.adminVipDistinctLists,
                        value: profile.distinctVipListsRequested,
                      ),
                      _CountTile(
                        key: const ValueKey('admin-vip-profile-vip-total'),
                        label: AppStrings.adminVipRequestTotal,
                        value: profile.vipRequestCount,
                      ),
                      _CountTile(
                        key: const ValueKey('admin-vip-profile-vip-open'),
                        label: AppStrings.adminVipRequestOpen,
                        value: profile.vipOpenRequestCount,
                      ),
                      _CountTile(
                        key: const ValueKey('admin-vip-profile-ordinary'),
                        label: AppStrings.adminVipOrdinaryRequests,
                        value: profile.ordinaryMessageRequestCount,
                      ),
                      _CountTile(
                        key: const ValueKey('admin-vip-profile-vip-sends'),
                        label: AppStrings.adminVipRecordedSends,
                        value: profile.vipRecordedSendCount,
                      ),
                      _CountTile(
                        key: const ValueKey('admin-vip-profile-ordinary-sends'),
                        label: AppStrings.adminVipOrdinaryRecordedSends,
                        value: profile.ordinaryRecordedSendCount,
                      ),
                      const SizedBox(height: AppTokens.space16),
                      FilledButton(
                        onPressed: _busy ? null : _confirmToggle,
                        child: Text(
                          profile.entitled
                              ? AppStrings.adminVipDisable
                              : AppStrings.adminVipEnable,
                        ),
                      ),
                      if (_busy)
                        const Padding(
                          padding: EdgeInsets.only(top: AppTokens.space12),
                          child: Center(child: CircularProgressIndicator()),
                        ),
                    ],
                  ),
      ),
    );
  }
}

class _CountTile extends StatelessWidget {
  const _CountTile({super.key, required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space12),
      child: AppSurface(
        padding: const EdgeInsets.all(AppTokens.space12),
        child: Row(
          children: [
            Expanded(child: Text(label)),
            Text(
              '$value',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
      ),
    );
  }
}
