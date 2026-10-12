import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shamsi_date/shamsi_date.dart';

import '../../core/networking/api_instant.dart';
import '../../core/state/providers.dart';
import 'intention_idempotency.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/jalali_date_picker.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

Future<Map<String, dynamic>?> promptVisitIntentionTime(BuildContext context) async {
  final precision = await showDialog<String>(
    context: context,
    builder: (dialogContext) => SimpleDialog(
      title: const Text(AppStrings.visitIntentionTitle),
      children: [
        SimpleDialogOption(
          onPressed: () => Navigator.pop(dialogContext, 'UNKNOWN'),
          child: const Text(AppStrings.timeUnknown),
        ),
        SimpleDialogOption(
          onPressed: () => Navigator.pop(dialogContext, 'DATE'),
          child: const Text(AppStrings.timeDateOnly),
        ),
        SimpleDialogOption(
          onPressed: () => Navigator.pop(dialogContext, 'INSTANT'),
          child: const Text(AppStrings.timeInstant),
        ),
      ],
    ),
  );
  if (precision == null || !context.mounted) return null;
  if (precision == 'UNKNOWN') return const {'precision': 'UNKNOWN'};
  final date = await showJalaliDatePicker(
    context: context,
    initialDate: DateTime.now(),
    firstDate: DateTime.now().subtract(const Duration(days: 365)),
    lastDate: DateTime.now().add(const Duration(days: 365)),
  );
  if (date == null || !context.mounted) return null;
  final gregorian = date.toGregorian();
  final agreedDate =
      '${gregorian.year.toString().padLeft(4, '0')}-${gregorian.month.toString().padLeft(2, '0')}-${gregorian.day.toString().padLeft(2, '0')}';
  if (precision == 'DATE') {
    return {'precision': 'DATE', 'agreedDate': agreedDate};
  }
  final clock = await showTimePicker(context: context, initialTime: TimeOfDay.now());
  if (clock == null) return null;
  return {
    'precision': 'INSTANT',
    'agreedInstant': toApiInstant(jalaliWithTimeToLocal(date, clock.hour, clock.minute)),
  };
}

class RecordVisitLink {
  const RecordVisitLink({
    this.commitment,
    this.visitIntentionId,
    this.createCustomer = false,
    this.disclosedDisplayName,
    this.disclosedPhone,
    this.identityDisclosure,
  });

  final ReturnCommitment? commitment;
  final String? visitIntentionId;
  final bool createCustomer;
  final String? disclosedDisplayName;
  final String? disclosedPhone;
  final String? identityDisclosure;
}

String visitOutcomeLabel({
  required bool operationallyOpen,
  required bool saleRecorded,
  required bool existingCustomerReturn,
  required bool vipAcquisitionByVisit,
}) {
  if (operationallyOpen) return AppStrings.visitIntentionTitle;
  if (vipAcquisitionByVisit) return AppStrings.vipAcquisitionByVisit;
  if (existingCustomerReturn) return AppStrings.existingCustomerReturn;
  if (saleRecorded) return AppStrings.visitWithSale;
  return AppStrings.visitWithoutSale;
}

class FollowUpsScreen extends ConsumerStatefulWidget {
  const FollowUpsScreen({super.key});

  @override
  ConsumerState<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsScreenState extends ConsumerState<FollowUpsScreen> {
  FollowUpPage? _customers;
  FollowUpPage? _vip;
  Object? _customerError;
  Object? _vipError;
  bool _customerLoading = true;
  bool _vipLoading = true;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _loadCustomers();
    _loadVip();
  }

  Future<void> _loadCustomers({bool more = false}) async {
    final generation = _generation;
    setState(() {
      _customerLoading = true;
      if (!more) _customerError = null;
    });
    try {
      final page = await ref.read(visitIntentionRepositoryProvider).customerFollowUps(
            cursor: more ? _customers?.nextCursor : null,
          );
      if (!mounted || generation != _generation) return;
      setState(() {
        _customers = more && _customers != null
            ? FollowUpPage(
                items: [..._customers!.items, ...page.items],
                hasMore: page.hasMore,
                openCount: page.openCount,
                nextCursor: page.nextCursor,
              )
            : page;
        _customerLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _customerError = error;
        _customerLoading = false;
      });
    }
  }

  Future<void> _loadVip({bool more = false}) async {
    final generation = _generation;
    setState(() {
      _vipLoading = true;
      if (!more) _vipError = null;
    });
    try {
      final page = await ref.read(visitIntentionRepositoryProvider).vipFollowUps(
            cursor: more ? _vip?.nextCursor : null,
          );
      if (!mounted || generation != _generation) return;
      setState(() {
        _vip = more && _vip != null
            ? FollowUpPage(
                items: [..._vip!.items, ...page.items],
                hasMore: page.hasMore,
                openCount: page.openCount,
                nextCursor: page.nextCursor,
              )
            : page;
        _vipLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _vipError = error;
        _vipLoading = false;
      });
    }
  }

  Future<void> _refresh() async {
    _generation += 1;
    await Future.wait([_loadCustomers(), _loadVip()]);
  }

  Future<void> _act(FollowUpItem item) async {
    if (item.nextAction == 'SELECT_CUSTOMER_THEN_RECORD_VISIT') {
      final recorded = await context.push<bool>(
        '/visit-intentions/${item.id}/choose-customer',
        extra: RecordVisitLink(
          visitIntentionId: item.id,
          disclosedDisplayName: item.disclosedDisplayName,
          disclosedPhone: item.disclosedPhone,
          identityDisclosure: item.identityDisclosure,
        ),
      );
      if (recorded == true) await _refresh();
      return;
    }
    final customerId = item.customerId;
    if (customerId == null) return;
    final recorded = await context.push<bool>(
      '/customers/$customerId/record-visit',
      extra: item.kind == 'RETURN_COMMITMENT'
          ? RecordVisitLink(commitment: _commitmentStub(item))
          : RecordVisitLink(visitIntentionId: item.id),
    );
    if (recorded == true) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text(AppStrings.followUpsTitle),
          bottom: const TabBar(
            tabs: [
              Tab(text: AppStrings.followUpsCustomersTab),
              Tab(text: AppStrings.followUpsVipTab),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _FollowUpList(
              page: _customers,
              error: _customerError,
              loading: _customerLoading,
              empty: AppStrings.followUpsCustomersEmpty,
              onRefresh: _refresh,
              onRetry: _loadCustomers,
              onMore: () => _loadCustomers(more: true),
              onAct: _act,
              vip: false,
            ),
            _FollowUpList(
              page: _vip,
              error: _vipError,
              loading: _vipLoading,
              empty: AppStrings.followUpsVipEmpty,
              onRefresh: _refresh,
              onRetry: _loadVip,
              onMore: () => _loadVip(more: true),
              onAct: _act,
              vip: true,
            ),
          ],
        ),
      ),
    );
  }
}

class _FollowUpList extends StatelessWidget {
  const _FollowUpList({
    required this.page,
    required this.error,
    required this.loading,
    required this.empty,
    required this.onRefresh,
    required this.onRetry,
    required this.onMore,
    required this.onAct,
    required this.vip,
  });

  final FollowUpPage? page;
  final Object? error;
  final bool loading;
  final String empty;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onRetry;
  final VoidCallback onMore;
  final Future<void> Function(FollowUpItem item) onAct;
  final bool vip;

  @override
  Widget build(BuildContext context) {
    if (loading && page == null) {
      return const LoadingSkeleton(lines: 4);
    }
    if (error != null && page == null) {
      return ErrorView(message: friendlyError(error!), onRetry: onRetry);
    }
    final items = page?.items ?? const <FollowUpItem>[];
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(AppTokens.space16),
        children: [
          Text(AppStrings.followUpsHint),
          const SizedBox(height: AppTokens.space12),
          if (items.isEmpty)
            EmptyStateView(title: empty, body: AppStrings.followUpsHint)
          else
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.space8),
                child: AppSurface(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        vip ? _vipTitle(item) : (item.customerDisplayName ?? ''),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if (vip) Text(AppStrings.vipReportedOrigin),
                      if (vip && item.identityDisclosure == 'WITHHELD')
                        const Text(AppStrings.vipIdentityWithheld),
                      if (vip && item.identityDisclosure == 'ADMIN_AUTHORIZED')
                        const Text(AppStrings.reportedByPlatformAdmin),
                      if (vip &&
                          (item.identityDisclosure == 'SALON_SUPPLIED' ||
                              item.identityDisclosure == 'ADMIN_AUTHORIZED') &&
                          item.disclosedPhone != null)
                        LtrText(item.disclosedPhone!),
                      Text(_reporter(item)),
                      Text(_time(item)),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton(
                          onPressed: () => onAct(item),
                          child: const Text(AppStrings.markVisited),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          if (error != null) ErrorView(message: friendlyError(error!), onRetry: onRetry),
          if (page?.hasMore == true)
            TextButton(
              onPressed: loading ? null : onMore,
              child: const Text(AppStrings.loadMore),
            ),
        ],
      ),
    );
  }
}

class VisitIntentionFormScreen extends ConsumerStatefulWidget {
  const VisitIntentionFormScreen({
    super.key,
    required this.targetId,
    this.vipRequest = false,
  });

  final String targetId;
  final bool vipRequest;

  @override
  ConsumerState<VisitIntentionFormScreen> createState() => _VisitIntentionFormScreenState();
}

class _VisitIntentionFormScreenState extends ConsumerState<VisitIntentionFormScreen> {
  String _precision = 'UNKNOWN';
  Jalali? _date;
  TimeOfDay? _time;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  bool _saving = false;
  String? _error;
  final _idempotency = StableIdempotencyKey();
  List<VisitIntention> _existing = const [];
  bool _listLoading = false;
  bool _listLoadingMore = false;
  bool _listLoaded = false;
  Object? _listError;
  bool _hasMore = false;
  String? _nextCursor;
  int _listGeneration = 0;

  @override
  void initState() {
    super.initState();
    if (widget.vipRequest) {
      Future<void>.microtask(_loadExisting);
    }
  }

  @override
  void didUpdateWidget(covariant VisitIntentionFormScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.vipRequest && oldWidget.targetId != widget.targetId) {
      setState(() {
        _existing = const [];
        _listLoaded = false;
        _listError = null;
        _hasMore = false;
        _nextCursor = null;
      });
      _loadExisting();
    }
  }

  Future<void> _loadExisting({bool more = false}) async {
    if (!widget.vipRequest) return;
    if (more) {
      if (_listLoadingMore || !_hasMore || _nextCursor == null) return;
    } else {
      _listGeneration += 1;
    }
    final generation = _listGeneration;
    final cursor = more ? _nextCursor : null;
    setState(() {
      if (more) {
        _listLoadingMore = true;
      } else {
        _listLoading = true;
        _listError = null;
      }
    });
    try {
      final page = await ref.read(visitIntentionRepositoryProvider).listForVipRequest(
            widget.targetId,
            cursor: cursor,
          );
      if (!mounted || generation != _listGeneration) return;
      setState(() {
        if (more) {
          final seen = _existing.map((item) => item.id).toSet();
          _existing = [
            ..._existing,
            ...page.items.where((item) => seen.add(item.id)),
          ];
        } else {
          _existing = page.items;
        }
        _hasMore = page.hasMore;
        _nextCursor = page.nextCursor;
        _listLoading = false;
        _listLoadingMore = false;
        _listLoaded = true;
        _listError = null;
      });
    } catch (error) {
      if (!mounted || generation != _listGeneration) return;
      setState(() {
        _listError = error;
        _listLoading = false;
        _listLoadingMore = false;
        _listLoaded = true;
      });
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final selected = await showJalaliDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (selected != null) setState(() => _date = selected);
  }

  Future<void> _save() async {
    if (_precision != 'UNKNOWN' && _date == null) {
      setState(() => _error = AppStrings.visitIntentionTitle);
      return;
    }
    if (_precision == 'INSTANT' && _time == null) {
      setState(() => _error = AppStrings.timeInstant);
      return;
    }
    final time = <String, dynamic>{'precision': _precision};
    if (_precision == 'DATE') {
      final gregorian = _date!.toGregorian();
      time['agreedDate'] =
          '${gregorian.year.toString().padLeft(4, '0')}-${gregorian.month.toString().padLeft(2, '0')}-${gregorian.day.toString().padLeft(2, '0')}';
    }
    if (_precision == 'INSTANT') {
      final local = jalaliWithTimeToLocal(_date!, _time!.hour, _time!.minute);
      time['agreedInstant'] = toApiInstant(local);
    }
    final name = _name.text.trim();
    final phone = _phone.text.trim();
    if (widget.vipRequest && name.isEmpty && phone.isEmpty) {
      setState(() => _error = AppStrings.vipContactRequired);
      return;
    }
    final signature = '${visitIntentionTimeSignature(time)}|$name|$phone';
    final idempotencyKey = _idempotency.forPayload(signature);
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repo = ref.read(visitIntentionRepositoryProvider);
      if (widget.vipRequest) {
        await repo.createForVipRequest(
          vipRequestId: widget.targetId,
          time: time,
          idempotencyKey: idempotencyKey,
          disclosedDisplayName: name.isEmpty ? null : name,
          disclosedPhone: phone.isEmpty ? null : phone,
        );
      } else {
        await repo.createForCustomer(
          customerId: widget.targetId,
          time: time,
          idempotencyKey: idempotencyKey,
        );
      }
      _idempotency.succeed();
      if (mounted) context.pop(true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = friendlyError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.recordVisitIntention)),
      body: ListView(
        padding: const EdgeInsets.all(AppTokens.space16),
        children: [
          if (widget.vipRequest) ...[
            if (_listLoading && !_listLoaded) const LoadingSkeleton(lines: 2),
            if (_listLoaded && _listError == null && _existing.isEmpty)
              const Text(AppStrings.vipRequestIntentionsEmpty),
            for (final item in _existing) ...[
              Text(_intentionContactTitle(item), key: Key('vip-intention-${item.id}')),
              if (item.identityDisclosure == 'WITHHELD')
                const Text(AppStrings.vipIdentityWithheld),
              if (item.identityDisclosure == 'ADMIN_AUTHORIZED')
                const Text(AppStrings.reportedByPlatformAdmin),
              if (item.identityDisclosure == 'SALON_SUPPLIED')
                const Text(AppStrings.reportedBySalonInbound),
              if (item.identityDisclosure == 'SALON_SUPPLIED' ||
                  item.identityDisclosure == 'ADMIN_AUTHORIZED')
                if (item.disclosedPhone != null) LtrText(item.disclosedPhone!),
              Text(
                visitOutcomeLabel(
                  operationallyOpen: item.operationallyOpen,
                  saleRecorded: item.saleRecorded,
                  existingCustomerReturn: item.existingCustomerReturn,
                  vipAcquisitionByVisit: item.vipAcquisitionByVisit,
                ),
                key: Key('vip-intention-status-${item.id}'),
              ),
              if (!item.operationallyOpen &&
                  (item.vipAcquisitionByVisit || item.existingCustomerReturn))
                Text(item.saleRecorded ? AppStrings.visitWithSale : AppStrings.visitWithoutSale),
              Text(_precisionLabel(item.timePrecision)),
              if (item.operationallyOpen)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton(
                    key: ValueKey('arrive-${item.id}'),
                    onPressed: () async {
                      final recorded = await context.push<bool>(
                        '/visit-intentions/${item.id}/choose-customer',
                        extra: RecordVisitLink(
                          visitIntentionId: item.id,
                          disclosedDisplayName: item.disclosedDisplayName,
                          disclosedPhone: item.disclosedPhone,
                          identityDisclosure: item.identityDisclosure,
                        ),
                      );
                      if (recorded == true) await _loadExisting();
                    },
                    child: const Text(AppStrings.markVisited),
                  ),
                ),
              const SizedBox(height: AppTokens.space8),
            ],
            if (_listError != null) ...[
              Text(friendlyError(_listError!)),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(
                  onPressed: () => _loadExisting(more: _existing.isNotEmpty && _hasMore),
                  child: const Text(AppStrings.retry),
                ),
              ),
            ],
            if (_hasMore && _listError == null)
              TextButton(
                key: const Key('vip-request-intentions-more'),
                onPressed: _listLoading || _listLoadingMore ? null : () => _loadExisting(more: true),
                child: _listLoadingMore
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text(AppStrings.loadMore),
              ),
            if (_listLoaded && _listError == null && _existing.isNotEmpty && !_hasMore && !_listLoadingMore)
              const Text(AppStrings.vipRequestIntentionsEnd),
          ],
          const Text(AppStrings.visitIntentionTitle),
          const SizedBox(height: AppTokens.space8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'UNKNOWN', label: Text(AppStrings.timeUnknown)),
              ButtonSegment(value: 'DATE', label: Text(AppStrings.timeDateOnly)),
              ButtonSegment(value: 'INSTANT', label: Text(AppStrings.timeInstant)),
            ],
            selected: {_precision},
            onSelectionChanged: (value) => setState(() => _precision = value.first),
          ),
          if (_precision != 'UNKNOWN') ...[
            const SizedBox(height: AppTokens.space12),
            OutlinedButton(
              onPressed: _pickDate,
              child: Text(_date == null ? AppStrings.timeDateOnly : formatJalaliDate(jalaliWithTimeToLocal(_date!, 12, 0))),
            ),
          ],
          if (_precision == 'INSTANT') ...[
            const SizedBox(height: AppTokens.space8),
            OutlinedButton(
              onPressed: () async {
                final picked = await showTimePicker(
                  context: context,
                  initialTime: _time ?? TimeOfDay.now(),
                );
                if (picked != null) setState(() => _time = picked);
              },
              child: Text(_time == null ? AppStrings.timeInstant : _time!.format(context)),
            ),
          ],
          if (widget.vipRequest) ...[
            const SizedBox(height: AppTokens.space16),
            const Text(AppStrings.vipDisclosedHint),
            TextField(
              key: const Key('vip-disclosed-name'),
              controller: _name,
              decoration: const InputDecoration(labelText: AppStrings.firstName),
            ),
            TextField(
              key: const Key('vip-disclosed-phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: AppStrings.phoneNumber),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: AppTokens.space12),
            Text(_error!),
          ],
          const SizedBox(height: AppTokens.space16),
          AppButton(
            key: const Key('save-visit-intention'),
            label: AppStrings.recordVisitIntention,
            onPressed: _saving ? null : _save,
            loading: _saving,
          ),
        ],
      ),
    );
  }
}

class CustomerIntentionsScreen extends ConsumerStatefulWidget {
  const CustomerIntentionsScreen({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<CustomerIntentionsScreen> createState() => _CustomerIntentionsScreenState();
}

class _CustomerIntentionsScreenState extends ConsumerState<CustomerIntentionsScreen> {
  ItemPage<VisitIntention>? _page;
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
      final page = await ref.read(visitIntentionRepositoryProvider).listForCustomer(widget.customerId);
      if (!mounted) return;
      setState(() {
        _page = page;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.inspectVisitIntentions)),
      body: _loading
          ? const LoadingSkeleton(lines: 3)
          : _error != null
              ? ErrorView(message: friendlyError(_error!), onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      if (_page!.items.isEmpty)
                        const EmptyStateView(
                          title: AppStrings.customerVisitIntentionsEmpty,
                          body: AppStrings.visitIntentionTitle,
                        ),
                      for (final item in _page!.items)
                        ListTile(
                          title: Text(
                            visitOutcomeLabel(
                              operationallyOpen: item.operationallyOpen,
                              saleRecorded: item.saleRecorded,
                              existingCustomerReturn: item.existingCustomerReturn,
                              vipAcquisitionByVisit: item.vipAcquisitionByVisit,
                            ),
                          ),
                          subtitle: Text(_intentionTime(item)),
                          trailing: item.operationallyOpen
                              ? TextButton(
                                  key: ValueKey('arrive-${item.id}'),
                                  onPressed: () async {
                                    final recorded = await context.push<bool>(
                                      '/customers/${widget.customerId}/record-visit',
                                      extra: RecordVisitLink(visitIntentionId: item.id),
                                    );
                                    if (recorded == true) await _load();
                                  },
                                  child: const Text(AppStrings.markVisited),
                                )
                              : null,
                        ),
                    ],
                  ),
                ),
    );
  }
}

class VipArrivalCustomerScreen extends ConsumerStatefulWidget {
  const VipArrivalCustomerScreen({
    super.key,
    required this.intentionId,
    this.link,
    this.initialQuery = '',
  });

  final String intentionId;
  final RecordVisitLink? link;
  final String initialQuery;

  @override
  ConsumerState<VipArrivalCustomerScreen> createState() => _VipArrivalCustomerScreenState();
}

class _VipArrivalCustomerScreenState extends ConsumerState<VipArrivalCustomerScreen> {
  late final TextEditingController _search;
  ItemPage<Customer>? _page;
  String _activeQuery = '';
  Object? _error;
  bool _loading = true;
  bool _loadingMore = false;
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    _search = TextEditingController(text: widget.initialQuery);
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final requestId = ++_requestId;
    final query = _search.text;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(customerRepositoryProvider).list(query: query);
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _page = page;
        _activeQuery = query.trim();
        _loading = false;
      });
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final page = _page;
    final cursor = page?.nextCursor;
    if (page == null || cursor == null || !page.hasMore || _loadingMore) return;
    final requestId = _requestId;
    final query = _activeQuery;
    setState(() => _loadingMore = true);
    try {
      final next = await ref.read(customerRepositoryProvider).list(
            query: query,
            cursor: cursor,
          );
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _page = ItemPage(
          items: [...page.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        );
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = error;
        _loadingMore = false;
      });
    }
  }

  Future<void> _choose(Customer customer) async {
    final recorded = await context.push<bool>(
      '/customers/${customer.id}/record-visit',
      extra: RecordVisitLink(visitIntentionId: widget.intentionId),
    );
    if (recorded == true && mounted) context.pop(true);
  }

  Future<void> _recordNewCustomer() async {
    final link = widget.link ?? RecordVisitLink(visitIntentionId: widget.intentionId);
    final recorded = await context.push<bool>(
      '/visit-intentions/${widget.intentionId}/record-visit',
      extra: RecordVisitLink(
        visitIntentionId: widget.intentionId,
        createCustomer: true,
        disclosedDisplayName: link.disclosedDisplayName,
        disclosedPhone: link.disclosedPhone,
        identityDisclosure: link.identityDisclosure,
      ),
    );
    if (recorded == true && mounted) context.pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final items = _page?.items ?? const <Customer>[];
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.chooseCustomerForVisit)),
      body: _loading && _page == null
          ? const LoadingSkeleton(lines: 4)
          : _error != null && _page == null
              ? ErrorView(message: friendlyError(_error!), onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    children: [
                      const Text(AppStrings.chooseCustomerHint),
                      const SizedBox(height: AppTokens.space8),
                      const Text(AppStrings.vipReportedOrigin),
                      TextField(
                        controller: _search,
                        textInputAction: TextInputAction.search,
                        decoration: const InputDecoration(
                          labelText: AppStrings.searchCustomers,
                        ),
                        onSubmitted: (_) => _load(),
                      ),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton(
                          onPressed: _loading ? null : _load,
                          child: const Text(AppStrings.searchCustomers),
                        ),
                      ),
                      OutlinedButton(
                        key: const Key('record-new-customer'),
                        onPressed: _recordNewCustomer,
                        child: const Text(AppStrings.recordVisitForNewCustomer),
                      ),
                      if (!_loading && items.isEmpty)
                        EmptyStateView(
                          title: _activeQuery.isEmpty
                              ? AppStrings.noCustomers
                              : AppStrings.noMatchingCustomers,
                          body: _activeQuery.isEmpty
                              ? AppStrings.chooseCustomerHint
                              : AppStrings.changeCustomerSearch,
                        ),
                      for (final customer in items)
                        ListTile(
                          key: ValueKey('customer-${customer.id}'),
                          title: Text(customer.fullName),
                          subtitle: LtrText(customer.phoneNumber),
                          onTap: () => _choose(customer),
                        ),
                      if (_error != null) ErrorView(message: friendlyError(_error!), onRetry: _load),
                      if (_page?.hasMore == true)
                        TextButton(
                          onPressed: _loading || _loadingMore ? null : _loadMore,
                          child: const Text(AppStrings.loadMore),
                        ),
                    ],
                  ),
                ),
    );
  }
}

String _intentionContactTitle(VisitIntention item) {
  final name = item.disclosedDisplayName?.trim();
  if ((item.identityDisclosure == 'SALON_SUPPLIED' ||
          item.identityDisclosure == 'ADMIN_AUTHORIZED') &&
      name != null &&
      name.isNotEmpty) {
    return name;
  }
  return 'مخاطب VIP';
}

String _precisionLabel(String precision) {
  switch (precision) {
    case 'DATE':
      return AppStrings.timeDateOnly;
    case 'INSTANT':
      return AppStrings.timeInstant;
    default:
      return AppStrings.visitIntentionUnknownTime;
  }
}

String _vipTitle(FollowUpItem item) {
  final name = item.disclosedDisplayName?.trim();
  if ((item.identityDisclosure == 'SALON_SUPPLIED' ||
          item.identityDisclosure == 'ADMIN_AUTHORIZED') &&
      name != null &&
      name.isNotEmpty) {
    return name;
  }
  return 'مخاطب VIP';
}

String _reporter(FollowUpItem item) {
  switch (item.reportChannel) {
    case 'INBOUND_TO_SALON':
      return AppStrings.reportedBySalonInbound;
    case 'REPORTED_DURING_MANUAL_HANDLING':
      return AppStrings.reportedByAdminHandling;
    case 'TOLD_PLATFORM_ADMIN':
      return AppStrings.reportedBySupport;
    case 'SALON_STAFF':
      return AppStrings.reportedBySalon;
    default:
      return item.reportedBy == 'PLATFORM_ADMIN'
          ? AppStrings.reportedCommitmentBySupport
          : AppStrings.reportedCommitmentBySalon;
  }
}

String _time(FollowUpItem item) {
  if (item.timePrecision == 'UNKNOWN' || !item.timeKnown && item.agreedDate == null && item.agreedInstant == null) {
    return AppStrings.visitIntentionUnknownTime;
  }
  if (item.timePrecision == 'DATE' && item.agreedDate != null) {
    final parts = item.agreedDate!.split('-');
    if (parts.length == 3) {
      final shown = formatJalaliDate(DateTime(
        int.parse(parts[0]),
        int.parse(parts[1]),
        int.parse(parts[2]),
        12,
      ));
      return '${AppStrings.visitIntentionTitle}: $shown';
    }
  }
  if (item.agreedInstant != null) {
    final label = '${AppStrings.visitIntentionTitle}: ${formatJalaliDateTime(item.agreedInstant!)}';
    if (item.timeKnown && item.agreedTimePassed) {
      return '$label — ${AppStrings.visitIntentionTimePassed}';
    }
    return label;
  }
  return AppStrings.visitIntentionUnknownTime;
}

String _intentionTime(VisitIntention item) {
  if (item.timePrecision == 'DATE' && item.agreedDate != null) {
    return '${AppStrings.visitIntentionTitle}: ${item.agreedDate}';
  }
  if (item.timeKnown && item.agreedInstant != null) {
    return '${AppStrings.visitIntentionTitle}: ${formatJalaliDateTime(item.agreedInstant!)}';
  }
  return AppStrings.visitIntentionUnknownTime;
}

ReturnCommitment _commitmentStub(FollowUpItem item) {
  final at = item.agreedInstant ?? item.reportedAt;
  return ReturnCommitment(
    id: item.id,
    customerId: item.customerId ?? '',
    sourceRequestId: '',
    sourceDeliveryId: '',
    expectedAt: at,
    createdAt: item.reportedAt,
    updatedAt: item.reportedAt,
  );
}
