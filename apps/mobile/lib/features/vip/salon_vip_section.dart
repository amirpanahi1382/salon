import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/networking/api_client.dart';
import '../../core/state/providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class VipSelectedCount extends Notifier<int?> {
  @override
  int? build() {
    ref.listen<AuthState>(authControllerProvider, (previous, next) {
      if (next.status != AuthStatus.signedIn || next.user?.isPlatformAdmin == true) {
        Future.microtask(() => state = null);
      }
    });
    return null;
  }

  void setValue(int? value) => state = value;
}

class VipSectionOpen extends Notifier<bool> {
  @override
  bool build() {
    ref.listen<AuthState>(authControllerProvider, (previous, next) {
      if (next.status != AuthStatus.signedIn || next.user?.isPlatformAdmin == true) {
        Future.microtask(() => state = false);
      }
    });
    return false;
  }

  void setOpen(bool value) => state = value;
}

final vipSelectedCountProvider =
    NotifierProvider<VipSelectedCount, int?>(VipSelectedCount.new);
final vipSectionOpenProvider =
    NotifierProvider<VipSectionOpen, bool>(VipSectionOpen.new);

class SalonVipSection extends ConsumerStatefulWidget {
  const SalonVipSection({super.key});

  @override
  ConsumerState<SalonVipSection> createState() => _SalonVipSectionState();
}

class _SalonVipSectionState extends ConsumerState<SalonVipSection> {
  List<VipTargetList> _lists = [];
  VipCapability? _capability;
  String? _listId;
  final _geo = TextEditingController();
  bool _loading = true;
  bool _busy = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _geo.dispose();
    super.dispose();
  }

  void _snack(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final capability = await ref.read(vipRepositoryProvider).capability();
      final lists = capability.entitled
          ? await ref.read(vipRepositoryProvider).activeLists()
          : <VipTargetList>[];
      if (!mounted) {
        return;
      }
      setState(() {
        _capability = capability;
        _lists = lists;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _submit() async {
    final count = ref.read(vipSelectedCountProvider);
    final listId = _listId;
    if (count == null || listId == null) {
      return;
    }
    setState(() => _busy = true);
    try {
      final created = await ref.read(vipRepositoryProvider).createRequest(
            listId: listId,
            requestedCount: count,
            geographicRange: _geo.text,
            idempotencyKey: createRequestId(),
          );
      if (!mounted) {
        return;
      }
      await _load();
      await _addSample(created);
    } catch (error) {
      _snack(friendlyError(error));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _addSample(VipRequest request) async {
    if (request.sampleWorks.length >= 3) {
      _snack(AppStrings.vipMaxSamples);
      return;
    }
    setState(() => _busy = true);
    try {
      final file = await FilePicker.pickFile(type: FileType.image);
      if (file == null) {
        await _load();
        return;
      }
      final latest = await ref.read(vipRepositoryProvider).getRequest(request.id);
      if (latest.sampleWorks.length >= 3) {
        _snack(AppStrings.vipMaxSamples);
        await _load();
        return;
      }
      await ref.read(vipRepositoryProvider).uploadSampleWork(
            requestId: request.id,
            bytes: await file.readAsBytes(),
            filename: file.name,
            idempotencyKey: createRequestId(),
          );
      await _load();
    } catch (error) {
      _snack(friendlyError(error));
      await _load();
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _submitExisting(VipRequest request) async {
    if (request.sampleWorks.isEmpty) {
      _snack(AppStrings.vipSampleNeeded);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(vipRepositoryProvider).submit(request.id, createRequestId());
      await _load();
    } catch (error) {
      _snack(friendlyError(error));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const LoadingSkeleton(lines: 4);
    }
    if (_error != null) {
      return ErrorView(message: friendlyError(_error!), onRetry: _load);
    }
    final capability = _capability;
    if (capability == null || !capability.entitled) {
      return const EmptyStateView(
        title: AppStrings.vipNeedEntitlement,
        body: AppStrings.vipNeedEntitlement,
      );
    }
    if (capability.currentRequest != null) {
      return _currentRequestView(capability);
    }
    if (capability.remainingQuota == 0) {
      return const EmptyStateView(
        title: AppStrings.vipQuotaExhausted,
        body: AppStrings.vipQuotaExhausted,
      );
    }
    final count = ref.watch(vipSelectedCountProvider);
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space16),
      children: [
        Text('${capability.remainingQuota} / 100'),
        Wrap(
          spacing: 8,
          children: [
            for (final value in [30, 50, 100])
              ChoiceChip(
                label: Text('$value'),
                selected: count == value,
                onSelected: (_) =>
                    ref.read(vipSelectedCountProvider.notifier).setValue(value),
              ),
          ],
        ),
        const SizedBox(height: 12),
        ..._lists.map(
          (list) => ListTile(
            title: Text(list.name),
            subtitle: Text('${list.contactCount}'),
            selected: _listId == list.id,
            onTap: () => setState(() => _listId = list.id),
          ),
        ),
        TextField(
          controller: _geo,
          decoration: const InputDecoration(labelText: AppStrings.vipSalonRange),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy || count == null || _listId == null ? null : _submit,
          child: const Text(AppStrings.sendMessageAction),
        ),
      ],
    );
  }

  Widget _currentRequestView(VipCapability capability) {
    final current = capability.currentRequest!;
    final awaiting = current.status == 'AWAITING_SAMPLE_WORK';
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space16),
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(current.listName),
          subtitle: Text('${current.status} · ${current.requestedCount}'),
        ),
        if (capability.remainingQuota == 0) ...[
          const SizedBox(height: 8),
          Text(
            AppStrings.vipQuotaExhausted,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (awaiting) ...[
          const SizedBox(height: 12),
          Text(AppStrings.vipSampleProgress(current.sampleWorks.length)),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy ? null : () => _addSample(current),
            child: const Text(AppStrings.vipAddSample),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _busy || current.sampleWorks.isEmpty
                ? null
                : () => _submitExisting(current),
            child: const Text(AppStrings.vipSubmit),
          ),
        ],
      ],
    );
  }
}
