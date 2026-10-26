import 'package:file_picker/file_picker.dart';
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
import 'vip_discount.dart';
import 'vip_progress_card.dart';
import 'vip_request_form_widgets.dart';

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

class VipFormPreviewSeed {
  const VipFormPreviewSeed({
    this.regionCode,
    this.count,
    this.listId,
    this.discountKind = VipDiscountKind.none,
    this.discountAmount = '',
  });

  final String? regionCode;
  final int? count;
  final String? listId;
  final VipDiscountKind discountKind;
  final String discountAmount;
}

class SalonVipSection extends ConsumerStatefulWidget {
  const SalonVipSection({super.key, this.previewSeed});

  /// Isolated preview/screenshot seed. Production never passes this.
  final VipFormPreviewSeed? previewSeed;

  @override
  ConsumerState<SalonVipSection> createState() => _SalonVipSectionState();
}

class _SalonVipSectionState extends ConsumerState<SalonVipSection> {
  List<VipRegion> _regions = const [];
  List<VipTargetList> _lists = const [];
  VipCapability? _capability;
  String? _regionCode;
  String? _listId;
  final _geo = TextEditingController();
  final _discountAmount = TextEditingController();
  VipDiscountKind _discountKind = VipDiscountKind.none;
  bool _loading = true;
  bool _listsLoading = false;
  bool _busy = false;
  Object? _error;
  Object? _listsError;
  int _loadGeneration = 0;
  int _listGeneration = 0;

  @override
  void initState() {
    super.initState();
    _geo.addListener(_onDraftChanged);
    _discountAmount.addListener(_onDraftChanged);
    _load();
  }

  void _onDraftChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _geo.removeListener(_onDraftChanged);
    _discountAmount.removeListener(_onDraftChanged);
    _geo.dispose();
    _discountAmount.dispose();
    super.dispose();
  }

  VipDiscountCopy get _discountCopy => const VipDiscountCopy(
    percentRange: AppStrings.vipDiscountPercentRange,
    amountRequired: AppStrings.vipDiscountAmountRequired,
    rialRequired: AppStrings.vipDiscountRialRequired,
  );

  VipDiscountParse get _discountParse =>
      parseVipDiscount(_discountKind, _discountAmount.text, copy: _discountCopy);

  void _setDiscountKind(VipDiscountKind kind) {
    setState(() {
      if (_discountKind != kind) {
        _discountAmount.clear();
      }
      _discountKind = kind;
    });
  }

  void _clearDiscount() {
    setState(() {
      _discountKind = VipDiscountKind.none;
      _discountAmount.clear();
    });
  }

  VipRegion? get _selectedRegion {
    final code = _regionCode;
    if (code == null) {
      return null;
    }
    for (final region in _regions) {
      if (region.regionCode == code) {
        return region;
      }
    }
    return null;
  }

  void _snack(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _load() async {
    final generation = ++_loadGeneration;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final capability = await ref.read(vipRepositoryProvider).capability();
      final regions = capability.entitled
          ? await ref.read(vipRepositoryProvider).regions()
          : <VipRegion>[];
      if (!mounted || generation != _loadGeneration) {
        return;
      }
      setState(() {
        _capability = capability;
        _regions = regions;
        _loading = false;
      });
      final previewSelectedRegion = widget.previewSeed?.regionCode != null;
      await _applyPreviewSeed();
      if (_regionCode != null && !previewSelectedRegion) {
        await _loadLists();
      }
    } catch (error) {
      if (!mounted || generation != _loadGeneration) {
        return;
      }
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _applyPreviewSeed() async {
    final seed = widget.previewSeed;
    if (seed == null) {
      return;
    }
    if (seed.count != null) {
      ref.read(vipSelectedCountProvider.notifier).setValue(seed.count);
    }
    VipRegion? region;
    for (final row in _regions) {
      if (row.regionCode == seed.regionCode) {
        region = row;
        break;
      }
    }
    if (region != null) {
      await _selectRegion(region);
    }
    if (seed.listId != null && mounted) {
      setState(() => _listId = seed.listId);
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _discountKind = seed.discountKind;
      _discountAmount.text = toPersianDigits(
        fromPersianDigits(seed.discountAmount),
      );
    });
  }

  Future<void> _loadLists() async {
    final code = _regionCode;
    if (code == null) {
      return;
    }
    final generation = ++_listGeneration;
    setState(() {
      _listsLoading = true;
      _listsError = null;
    });
    try {
      final lists = await ref.read(vipRepositoryProvider).listsByRegion(code);
      if (!mounted || generation != _listGeneration) {
        return;
      }
      setState(() {
        _lists = lists;
        _listsLoading = false;
        if (_listId != null && !lists.any((row) => row.id == _listId)) {
          _listId = null;
        }
      });
    } catch (error) {
      if (!mounted || generation != _listGeneration) {
        return;
      }
      setState(() {
        _listsError = error;
        _listsLoading = false;
        _lists = const [];
      });
    }
  }

  Future<void> _selectRegion(VipRegion region) async {
    final shouldPrefillGeo = _geo.text.trim().isEmpty ||
        _regions.any((row) => row.regionName == _geo.text.trim());
    setState(() {
      _regionCode = region.regionCode;
      _listId = null;
      _lists = const [];
    });
    if (shouldPrefillGeo) {
      _geo.text = region.regionName;
    }
    await _loadLists();
  }

  bool _selectionAllowed(
    VipCapability capability,
    int? count,
    VipTargetList? selectedList,
    List<int> sizes,
  ) {
    if (_busy || count == null || selectedList == null) {
      return false;
    }
    if (!sizes.contains(count)) {
      return false;
    }
    if (count > capability.remainingQuota) {
      return false;
    }
    if (selectedList.sendableCount < count) {
      return false;
    }
    return true;
  }

  Future<void> _submit() async {
    final capability = _capability;
    final count = ref.read(vipSelectedCountProvider);
    final listId = _listId;
    VipTargetList? selectedList;
    for (final list in _lists) {
      if (list.id == listId) {
        selectedList = list;
        break;
      }
    }
    final sizes = capability == null || capability.allowedRequestCounts.isEmpty
        ? const [30, 50, 100]
        : capability.allowedRequestCounts;
    if (capability == null ||
        count == null ||
        listId == null ||
        !_selectionAllowed(capability, count, selectedList, sizes)) {
      return;
    }
    if (_discountKind != VipDiscountKind.none) {
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
      await _load();
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
      await _load();
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _openRegionPicker() async {
    final selected = await showModalBottomSheet<VipRegion>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return SafeArea(
          child: SizedBox(
            height: 480,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppTokens.space16),
                  child: Text(
                    AppStrings.vipSelectRegion,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        for (final region in _regions)
                          ListTile(
                            title: Text(
                              '${region.regionCode} — ${region.regionName}',
                            ),
                            subtitle: Text(
                              toPersianDigits(
                                region.availableContactCount.toString(),
                              ),
                            ),
                            selected: region.regionCode == _regionCode,
                            onTap: () => Navigator.of(context).pop(region),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (selected != null) {
      await _selectRegion(selected);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          key: const Key('vip-request-form-scroll'),
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 24),
            LoadingSkeleton(lines: 4),
          ],
        ),
      );
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
    final draft = capability.activeDraft ?? capability.currentRequest;
    if (draft != null && draft.status == 'AWAITING_SAMPLE_WORK') {
      return _scrollable(_currentRequestView(capability, draft));
    }
    final sizes = capability.allowedRequestCounts.isEmpty
        ? const [30, 50, 100]
        : capability.allowedRequestCounts;
    final minimumSize = sizes.reduce((left, right) => left < right ? left : right);
    if (capability.remainingQuota < minimumSize) {
      final belowMinimum = capability.remainingQuota > 0;
      final message = belowMinimum
          ? AppStrings.vipQuotaBelowMinimum(capability.remainingQuota)
          : AppStrings.vipQuotaExhausted;
      return _scrollable(
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _history(capability),
            EmptyStateView(title: message, body: message),
          ],
        ),
      );
    }
    final count = ref.watch(vipSelectedCountProvider);
    VipTargetList? selectedList;
    for (final list in _lists) {
      if (list.id == _listId) {
        selectedList = list;
        break;
      }
    }
    final visibleLists = _lists.where((list) {
      return count == null || list.sendableCount >= count;
    }).toList();
    final region = _selectedRegion;

    final discountBlocksCreate = _discountKind != VipDiscountKind.none;
    final canSubmit =
        _selectionAllowed(capability, count, selectedList, sizes) &&
        !discountBlocksCreate;
    return _scrollable(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _history(capability),
          VipQuotaCard(remaining: capability.remainingQuota),
          const SizedBox(height: AppTokens.space16),
          const SectionHeader(AppStrings.vipDesiredRegion),
          VipRequestSizeSelector(
            sizes: sizes,
            selected: count,
            remainingQuota: capability.remainingQuota,
            selectedListSendableCount: selectedList?.sendableCount,
            enabled: !_busy,
            onSelected: (value) {
              ref.read(vipSelectedCountProvider.notifier).setValue(value);
              if (selectedList != null && selectedList.sendableCount < value) {
                setState(() => _listId = null);
              }
            },
          ),
          const SizedBox(height: AppTokens.space12),
          VipRegionPickerTile(
            label: region == null
                ? AppStrings.vipSelectRegion
                : '${region.regionCode} — ${region.regionName}',
            enabled: !_busy,
            onTap: _openRegionPicker,
          ),
          const SizedBox(height: AppTokens.space16),
          if (_regionCode == null)
            const SizedBox.shrink()
          else ...[
            const SectionHeader(AppStrings.vipSelectList),
            if (_listsLoading)
              const LoadingSkeleton(lines: 3)
            else if (_listsError != null)
              ErrorView(message: friendlyError(_listsError!), onRetry: _loadLists)
            else if (_lists.isEmpty)
              const EmptyStateView(
                title: AppStrings.vipNoActiveListsInRegion,
                body: AppStrings.vipNoActiveListsInRegion,
                compact: true,
              )
            else if (visibleLists.isEmpty)
              const EmptyStateView(
                title: AppStrings.vipListsTooSmallForCount,
                body: AppStrings.vipListsTooSmallForCount,
                compact: true,
              )
            else
              ...[
                for (final list in visibleLists) ...[
                  AppSurface(
                    tone: _listId == list.id
                        ? AppSurfaceTone.hero
                        : AppSurfaceTone.elevated,
                    onTap: _busy ? null : () => setState(() => _listId = list.id),
                    padding: const EdgeInsets.all(AppTokens.space12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                AppStrings.vipListCardTitle(list.name),
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                            ),
                            if (_listId == list.id)
                              const Icon(
                                Icons.check,
                                color: AppTokens.accent,
                                size: 18,
                              ),
                          ],
                        ),
                        if (list.regionName != null) ...[
                          const SizedBox(height: 4),
                          Text(list.regionName!),
                        ],
                        const SizedBox(height: 4),
                        Text(
                          '${AppStrings.vipContactCountLabel}: ${toPersianDigits(list.sendableCount.toString())}',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              ],
            const SizedBox(height: AppTokens.space8),
          ],
          const SizedBox(height: AppTokens.space8),
          VipDiscountSection(
            kind: _discountKind,
            amountController: _discountAmount,
            parse: _discountParse,
            enabled: !_busy,
            onKindSelected: _setDiscountKind,
            onAmountChanged: (value) {
              final normalized = toPersianDigits(fromPersianDigits(value));
              if (normalized != value) {
                _discountAmount.value = TextEditingValue(
                  text: normalized,
                  selection: TextSelection.collapsed(offset: normalized.length),
                );
              }
            },
            onClear: _clearDiscount,
          ),
          const SizedBox(height: AppTokens.space16),
          VipOrderSummary(
            key: const Key('vip-order-summary'),
            count: count,
            region: region,
            selectedList: selectedList,
            discountKind: _discountKind,
            discountParse: _discountParse,
          ),
          const SizedBox(height: AppTokens.space16),
          VipPrimaryAction(
            enabled: canSubmit,
            busy: _busy,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }

  Widget _scrollable(Widget child) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const Key('vip-request-form-scroll'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppTokens.space16),
        children: [child],
      ),
    );
  }

  Widget _history(VipCapability capability) {
    final cancelled = capability.latestCancelledRequest;
    final hasInProgress =
        capability.inProgressRequests.isNotEmpty || capability.inProgressRequestsHasMore;
    if (!hasInProgress && cancelled == null) {
      return const SizedBox.shrink();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (hasInProgress) ...[
          Text(
            AppStrings.vipInProgressRequests,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          for (final request in capability.inProgressRequests)
            _associatedRequest(request),
          if (capability.inProgressRequestsHasMore) ...[
            const SizedBox(height: 4),
            const Text(AppStrings.vipInProgressRequestsTruncated),
          ],
        ],
        if (cancelled != null) _associatedRequest(cancelled, intention: false),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _associatedRequest(VipRequest request, {bool intention = true}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('${AppStrings.vipListNameLabel}: ${request.listName}'),
          Text(AppStrings.vipRequestedRecipientCount(request.requestedCount)),
          const SizedBox(height: 8),
          if (request.progress != null)
            VipProgressCard(progress: request.progress!)
          else
            Text('${vipRequestStatusLabel(request.status)} · ${request.requestedCount}'),
          if (intention)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => context.push('/vip/requests/${request.id}/visit-intention'),
                child: const Text(AppStrings.recordVisitIntention),
              ),
            ),
        ],
      ),
    );
  }

  Widget _currentRequestView(VipCapability capability, VipRequest current) {
    final awaiting = current.progress == null
        ? current.status == 'AWAITING_SAMPLE_WORK'
        : current.progress!.reservationStillValid;
    final sampleActions = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(AppStrings.vipSampleProgress(current.sampleWorks.length)),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy ? null : () => _addSample(current),
          child: const Text(AppStrings.vipAddSample),
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _busy || current.sampleWorks.isEmpty ? null : () => _submitExisting(current),
          child: const Text(AppStrings.vipSubmit),
        ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _history(capability),
        Text('${AppStrings.vipListNameLabel}: ${current.listName}'),
        Text(AppStrings.vipRequestedRecipientCount(current.requestedCount)),
        const SizedBox(height: 8),
        if (current.progress != null)
          VipProgressCard(
            progress: current.progress!,
            action: awaiting ? sampleActions : null,
          )
        else
          Text('${vipRequestStatusLabel(current.status)} · ${current.requestedCount}'),
        if (capability.remainingQuota == 0) ...[
          const SizedBox(height: 8),
          Text(
            AppStrings.vipQuotaExhausted,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (current.progress == null && awaiting) ...[
          const SizedBox(height: 12),
          sampleActions,
        ],
      ],
    );
  }
}
