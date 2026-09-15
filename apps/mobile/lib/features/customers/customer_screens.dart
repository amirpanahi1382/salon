import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/jalali_date_picker.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import '../opportunities/opportunity_action_bar.dart';
import '../outreach/manual_outreach_selection.dart';
import '../outreach/manual_outreach_state.dart';
import '../vip/salon_vip_section.dart';
import 'customer_validation.dart';

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  final _search = TextEditingController();
  List<Customer> _items = const [];
  String? _nextCursor;
  bool _hasMore = false;
  Object? _error;
  bool _loading = true;
  bool _loadingMore = false;
  bool _vipEntitled = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _nextCursor = null;
      _hasMore = false;
    });
    try {
      final page = await ref
          .read(customerRepositoryProvider)
          .list(query: _search.text);
      var entitled = false;
      try {
        entitled = (await ref.read(vipRepositoryProvider).capability()).entitled;
      } catch (_) {}
      if (!mounted) {
        return;
      }
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
        _vipEntitled = entitled;
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

  Future<void> _loadMore() async {
    if (_loading || _loadingMore || !_hasMore || _nextCursor == null) {
      return;
    }
    setState(() => _loadingMore = true);
    try {
      final page = await ref
          .read(customerRepositoryProvider)
          .list(query: _search.text, cursor: _nextCursor);
      if (!mounted) {
        return;
      }
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final outreach = ref.watch(manualOutreachSelectionProvider);
    return Scaffold(
      appBar: AppBar(
        title: outreach.selecting
            ? Text(
                '${AppStrings.customerSelectionTitle} ${outreach.selectedCount} / ${ManualOutreachState.maxSelection}',
              )
            : const Text(AppStrings.customers),
        actions: [
          if (outreach.selecting)
            TextButton(
              onPressed: () =>
                  ref.read(manualOutreachSelectionProvider.notifier).exitSelection(),
              child: const Text(AppStrings.cancelSelection),
            )
          else ...[
            TextButton(
              onPressed: _items.isEmpty
                  ? null
                  : () => ref
                      .read(manualOutreachSelectionProvider.notifier)
                      .enterSelection(),
              child: const Text(AppStrings.selectMultipleCustomers),
            ),
            IconButton(
              tooltip: AppStrings.importFromExcel,
              onPressed: () async {
                final imported = await context.push<bool>('/customers/import');
                if (imported == true) {
                  _load();
                }
              },
              icon: const Icon(Icons.upload_file_outlined),
            ),
          ],
        ],
      ),
      floatingActionButton: outreach.selecting
          ? null
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (_vipEntitled)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: FloatingActionButton.extended(
                      heroTag: 'vip-outreach',
                      onPressed: () async {
                        final count = await showModalBottomSheet<int>(
                          context: context,
                          builder: (context) => const _VipCountSheet(),
                        );
                        if (count == null || !context.mounted) {
                          return;
                        }
                        ref.read(vipSelectedCountProvider.notifier).setValue(count);
                        ref.read(vipSectionOpenProvider.notifier).setOpen(true);
                        context.go('/opportunities');
                      },
                      label: const Text(AppStrings.vipSendMessage),
                      icon: const Icon(Icons.star_outline),
                    ),
                  ),
                FloatingActionButton.extended(
                  heroTag: 'add-customer',
                  onPressed: () async {
                    final created = await context.push<bool>('/customers/new');
                    if (created == true) {
                      _load();
                    }
                  },
                  label: const Text(AppStrings.addCustomer),
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
      bottomNavigationBar: outreach.selecting
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: FilledButton(
                  onPressed: outreach.selectedCount == 0
                      ? null
                      : () {
                          ref
                              .read(manualOutreachSelectionProvider.notifier)
                              .confirmAndFocusOpportunities();
                          context.go('/opportunities');
                        },
                  child: const Text(AppStrings.sendMessageAction),
                ),
              ),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _search,
              decoration: const InputDecoration(
                labelText: AppStrings.searchCustomers,
                prefixIcon: Icon(Icons.search),
              ),
              onSubmitted: (_) => _load(),
              onChanged: (value) {
                if (value.isEmpty) {
                  _load();
                }
              },
            ),
          ),
          if (outreach.limitMessage != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                outreach.limitMessage!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          Expanded(
            child: _loading
                ? const LoadingView()
                : _error != null
                ? ErrorView(message: friendlyError(_error!), onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: PagedNotificationListener(
                      hasMore: _hasMore,
                      loading: _loading || _loadingMore,
                      onLoadMore: _loadMore,
                      child: _items.isEmpty
                        ? ListView(
                            primary: true,
                            children: [
                              const SizedBox(height: 48),
                              EmptyStateView(
                                title: AppStrings.noCustomers,
                                body: AppStrings.addFirstCustomer,
                                action: Wrap(
                                  alignment: WrapAlignment.center,
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    FilledButton(
                                      onPressed: () async {
                                        final created = await context
                                            .push<bool>('/customers/new');
                                        if (created == true) {
                                          _load();
                                        }
                                      },
                                      child: const Text(AppStrings.addCustomer),
                                    ),
                                    OutlinedButton(
                                      onPressed: () async {
                                        final imported = await context
                                            .push<bool>('/customers/import');
                                        if (imported == true) {
                                          _load();
                                        }
                                      },
                                      child: const Text(
                                        AppStrings.importFromExcel,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          )
                        : ListView.separated(
                            primary: true,
                            itemCount: _items.length + (_hasMore ? 1 : 0),
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              if (index >= _items.length) {
                                return PagedFooter(loading: _loadingMore);
                              }
                              final customer = _items[index];
                              if (outreach.selecting) {
                                final selected = outreach.isSelected(customer.id);
                                return Semantics(
                                  label:
                                      '${AppStrings.outreachSelectCustomer} ${customer.fullName}',
                                  selected: selected,
                                  child: CheckboxListTile(
                                    value: selected,
                                    title: Text(customer.fullName),
                                    subtitle: LtrText(customer.phoneNumber),
                                    onChanged: (_) {
                                      final ok = ref
                                          .read(
                                            manualOutreachSelectionProvider
                                                .notifier,
                                          )
                                          .toggle(customer);
                                      if (!ok && context.mounted) {
                                        ScaffoldMessenger.of(context)
                                            .showSnackBar(
                                          const SnackBar(
                                            content: Text(
                                              AppStrings.selectionLimitReached,
                                            ),
                                          ),
                                        );
                                      }
                                    },
                                  ),
                                );
                              }
                              return CustomerListTile(
                                name: customer.fullName,
                                phone: customer.phoneNumber,
                                onTap: () async {
                                  final deleted = await context.push<bool>(
                                    '/customers/${customer.id}',
                                  );
                                  if (deleted == true) {
                                    _load();
                                  }
                                },
                              );
                            },
                          ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class CustomerFormScreen extends ConsumerStatefulWidget {
  const CustomerFormScreen({super.key, this.customer});

  final Customer? customer;

  @override
  ConsumerState<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends ConsumerState<CustomerFormScreen> {
  late final TextEditingController _first;
  late final TextEditingController _last;
  late final TextEditingController _phone;
  String? _error;
  bool _loading = false;
  bool _created = false;

  @override
  void initState() {
    super.initState();
    _first = TextEditingController(text: widget.customer?.firstName ?? '');
    _last = TextEditingController(text: widget.customer?.lastName ?? '');
    _phone = TextEditingController(text: widget.customer?.phoneNumber ?? '');
  }

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    _phone.dispose();
    super.dispose();
  }

  bool get _isCreate => widget.customer == null;

  void _returnToCustomers() {
    if (context.canPop()) {
      context.pop(_created);
      return;
    }
    context.go('/customers');
  }

  Future<void> _save() async {
    final firstNameError = CustomerFieldValidation.firstNameError(_first.text);
    final lastNameError = CustomerFieldValidation.lastNameError(_last.text);
    final phoneError = CustomerFieldValidation.phoneError(_phone.text);
    if (firstNameError != null || lastNameError != null || phoneError != null) {
      setState(() {
        _error = firstNameError ?? lastNameError ?? phoneError;
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_isCreate) {
        await ref
            .read(customerRepositoryProvider)
            .create(
              firstName: _first.text.trim(),
              lastName: _last.text.trim(),
              phoneNumber: _phone.text,
            );
        if (!mounted) {
          return;
        }
        setState(() {
          _created = true;
          _loading = false;
        });
      } else {
        await ref
            .read(customerRepositoryProvider)
            .update(
              id: widget.customer!.id,
              firstName: _first.text.trim(),
              lastName: _last.text.trim(),
              phoneNumber: _phone.text,
            );
        if (!mounted) {
          return;
        }
        context.pop(true);
      }
    } catch (error) {
      setState(() => _error = friendlyError(error));
    } finally {
      if (mounted && !_created) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_isCreate,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop || !_isCreate) {
          return;
        }
        _returnToCustomers();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            _isCreate ? AppStrings.addCustomer : AppStrings.editCustomer,
          ),
          leading: _isCreate
              ? IconButton(
                  icon: const BackButtonIcon(),
                  onPressed: _returnToCustomers,
                )
              : null,
        ),
        body: _created
            ? ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    AppStrings.customerCreated,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _returnToCustomers,
                    child: const Text(AppStrings.backToCustomers),
                  ),
                ],
              )
            : ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  AppTextField(label: AppStrings.firstName, controller: _first),
                  const SizedBox(height: 12),
                  AppTextField(label: AppStrings.lastName, controller: _last),
                  const SizedBox(height: 12),
                  AppTextField(
                    label: AppStrings.phoneNumber,
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    textDirection: TextDirection.ltr,
                  ),
                  const SizedBox(height: 8),
                  const Text(AppStrings.phoneHint),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  AppButton(
                    label: AppStrings.save,
                    onPressed: _save,
                    loading: _loading,
                  ),
                ],
              ),
      ),
    );
  }
}

class CustomerDetailScreen extends ConsumerStatefulWidget {
  const CustomerDetailScreen({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<CustomerDetailScreen> createState() =>
      _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends ConsumerState<CustomerDetailScreen> {
  Customer? _customer;
  CustomerIntelligence? _intelligence;
  List<Visit> _visits = const [];
  String? _visitsCursor;
  bool _visitsHasMore = false;
  bool _loadingMoreVisits = false;
  List<CustomerActivityItem> _activity = const [];
  String? _activityCursor;
  bool _activityHasMore = false;
  bool _loadingMoreActivity = false;
  Map<String, OpportunityAction> _openActions = const {};
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
      final customer = await ref
          .read(customerRepositoryProvider)
          .getById(widget.customerId);
      final intelligence = await ref
          .read(intelligenceRepositoryProvider)
          .forCustomer(widget.customerId);
      final visits = await ref
          .read(visitRepositoryProvider)
          .listForCustomer(widget.customerId);
      final activity = await ref
          .read(customerRepositoryProvider)
          .listActivity(widget.customerId);
      final openActions = await ref
          .read(actionRepositoryProvider)
          .listForCustomer(widget.customerId, status: 'OPEN');
      if (!mounted) {
        return;
      }
      setState(() {
        _customer = customer;
        _intelligence = intelligence;
        _visits = visits.items;
        _visitsCursor = visits.nextCursor;
        _visitsHasMore = visits.hasMore;
        _activity = activity.items;
        _activityCursor = activity.nextCursor;
        _activityHasMore = activity.hasMore;
        _openActions = {
          for (final action in openActions.items)
            opportunityActionKey(action.customerId, action.opportunityType):
                action,
        };
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

  Future<void> _loadMoreVisits() async {
    if (_loading || _loadingMoreVisits || !_visitsHasMore || _visitsCursor == null) {
      return;
    }
    setState(() => _loadingMoreVisits = true);
    try {
      final page = await ref
          .read(visitRepositoryProvider)
          .listForCustomer(widget.customerId, cursor: _visitsCursor);
      if (!mounted) {
        return;
      }
      setState(() {
        _visits = [..._visits, ...page.items];
        _visitsCursor = page.nextCursor;
        _visitsHasMore = page.hasMore;
        _loadingMoreVisits = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _loadingMoreVisits = false);
    }
  }

  Future<void> _loadMoreActivity() async {
    if (_loading || _loadingMoreActivity || !_activityHasMore || _activityCursor == null) {
      return;
    }
    setState(() => _loadingMoreActivity = true);
    try {
      final page = await ref
          .read(customerRepositoryProvider)
          .listActivity(widget.customerId, cursor: _activityCursor);
      if (!mounted) {
        return;
      }
      setState(() {
        final seen = {for (final item in _activity) '${item.type}:${item.id}'};
        _activity = [
          ..._activity,
          ...page.items.where((item) => seen.add('${item.type}:${item.id}')),
        ];
        _activityCursor = page.nextCursor;
        _activityHasMore = page.hasMore;
        _loadingMoreActivity = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _loadingMoreActivity = false);
    }
  }

  Future<void> _deleteCustomer(Customer customer) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text(AppStrings.deleteCustomer),
        content: const Text(AppStrings.deleteCustomerConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(AppStrings.delete),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    try {
      await ref.read(customerRepositoryProvider).delete(customer.id);
      if (!mounted) {
        return;
      }
      if (context.canPop()) {
        context.pop(true);
      } else {
        context.go('/customers');
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyError(error))));
    }
  }

  Future<void> _deleteVisit(Visit visit) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text(AppStrings.deleteVisit),
        content: const Text(AppStrings.deleteVisitConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(AppStrings.delete),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    try {
      await ref.read(visitRepositoryProvider).delete(visit.id);
      if (!mounted) {
        return;
      }
      await _load();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyError(error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _customer == null) {
      return const Scaffold(body: LoadingView());
    }
    if (_error != null && _customer == null) {
      return Scaffold(
        appBar: AppBar(),
        body: ErrorView(message: friendlyError(_error!), onRetry: _load),
      );
    }
    final customer = _customer!;
    final intelligence = _intelligence;
    final canManage = ref.watch(authControllerProvider).user?.role != 'STAFF';
    return OpportunityActionsScope(
      onChanged: _load,
      child: Scaffold(
      appBar: AppBar(
        title: Text(customer.fullName),
        actions: [
          TextButton(
            onPressed: () async {
              final created = await context.push<bool>('/customers/new');
              if (!context.mounted) {
                return;
              }
              if (created == true) {
                context.go('/customers');
              }
            },
            child: const Text(AppStrings.addCustomer),
          ),
          if (canManage)
            IconButton(
              tooltip: AppStrings.editCustomer,
              onPressed: () async {
                final updated = await context.push<bool>(
                  '/customers/${customer.id}/edit',
                  extra: customer,
                );
                if (updated == true) {
                  _load();
                }
              },
              icon: const Icon(Icons.edit_outlined),
            ),
          if (canManage)
            IconButton(
              tooltip: AppStrings.deleteCustomer,
              onPressed: () => _deleteCustomer(customer),
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final recorded = await context.push<bool>(
            '/customers/${customer.id}/record-visit',
          );
          if (recorded == true) {
            _load();
          }
        },
        icon: const Icon(Icons.event_available_outlined),
        label: const Text(AppStrings.recordVisit),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: PagedNotificationListener(
          hasMore: _visitsHasMore || _activityHasMore,
          loading: _loading || _loadingMoreVisits || _loadingMoreActivity,
          onLoadMore: () {
            _loadMoreVisits();
            _loadMoreActivity();
          },
          child: ListView(
          primary: true,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    customer.fullName,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  LtrText(customer.phoneNumber),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (intelligence != null) ...[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StatusBadge(status: intelligence.status),
                    const SizedBox(height: 16),
                    Text(
                      AppStrings.why,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: 8),
                    Text(localizeIntelligenceCopy(intelligence.explanation)),
                    if (intelligence.opportunities.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        AppStrings.recommended,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        localizeIntelligenceCopy(
                          intelligence.opportunities.first.recommendedAction,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        AppStrings.recommendationNote,
                        style: TextStyle(fontSize: 12),
                      ),
                      const SizedBox(height: 12),
                      ...intelligence.opportunities.map(
                        (opportunity) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: OpportunityActionBar(
                            customerId: opportunity.customerId,
                            opportunityType: opportunity.type,
                            customerName: customer.fullName,
                            destinationHint: maskCustomerPhone(customer.phoneNumber),
                            openAction: _openActions[opportunityActionKey(
                              opportunity.customerId,
                              opportunity.type,
                            )],
                          ),
                        ),
                      ),
                    ],
                    if (intelligence.signals.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 8,
                        children: intelligence.signals
                            .map(
                              (signal) =>
                                  Chip(label: Text(signalLabel(signal))),
                            )
                            .toList(),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
            if (intelligence != null) ...[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      AppStrings.completedRevenueTitle,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: 8),
                    LtrText(
                      '${intelligence.revenue?.totalRevenue ?? '0.00'} ${AppStrings.rial}',
                    ),
                    Text(
                      '${toPersianDigits('${intelligence.revenue?.transactionCount ?? 0}')} تراکنش تکمیل‌شده · ${AppStrings.revenueUtcNote}',
                    ),
                    if (intelligence.revenue?.averageSpendPerVisit != null)
                      Text(
                        '${AppStrings.avgSpendPerVisit} ${intelligence.revenue!.averageSpendPerVisit} ${AppStrings.rial}',
                      ),
                    if (intelligence.revenue?.averageRevenuePerTransaction !=
                        null)
                      Text(
                        '${AppStrings.avgRevenuePerTransaction} ${intelligence.revenue!.averageRevenuePerTransaction} ${AppStrings.rial}',
                      ),
                    const SizedBox(height: 8),
                    const Text(
                      AppStrings.revenueOnlyCompletedNote,
                      style: TextStyle(fontSize: 12, height: 1.6),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
            Builder(
              builder: (context) {
                final visibleActivity = [
                  for (final item in _activity)
                    if (item.type != 'VISIT') item,
                ];
                if (visibleActivity.isEmpty && !_activityHasMore) {
                  return const SizedBox.shrink();
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      AppStrings.customerActivity,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    ...visibleActivity.map((item) {
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(customerActivityTitle(item)),
                        subtitle: Text(
                          item.type == 'MANUAL_MESSAGE' ||
                                  item.type == 'OPPORTUNITY_ACTION'
                              ? '${customerActivitySubtitle(item)}\n${formatJalaliDateTime(item.occurredAt)}'
                              : customerActivitySubtitle(item),
                        ),
                        isThreeLine: item.type == 'MANUAL_MESSAGE' ||
                            item.type == 'OPPORTUNITY_ACTION',
                      );
                    }),
                    if (_activityHasMore)
                      PagedFooter(loading: _loadingMoreActivity),
                    const SizedBox(height: 16),
                  ],
                );
              },
            ),
            Text(
              AppStrings.visitHistory,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (_visits.isEmpty)
              const EmptyStateView(
                title: AppStrings.noVisits,
                body: AppStrings.emptyVisitHistoryBody,
              )
            else
              ..._visits.map(
                (visit) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: canManage
                      ? IconButton(
                          tooltip: AppStrings.deleteVisit,
                          onPressed: () => _deleteVisit(visit),
                          icon: const Icon(Icons.delete_outline),
                        )
                      : null,
                  title: Text(formatJalaliDateTime(visit.visitedAt)),
                  subtitle: Text(
                    '${visit.serviceLabel} · ${visit.amountLabel}',
                  ),
                ),
              ),
            if (_visitsHasMore) PagedFooter(loading: _loadingMoreVisits),
          ],
        ),
        ),
      ),
    ),
    );
  }
}

class RecordVisitScreen extends ConsumerStatefulWidget {
  const RecordVisitScreen({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<RecordVisitScreen> createState() => _RecordVisitScreenState();
}

final _amountPattern = RegExp(r'^(0|[1-9]\d*)(\.\d{1,2})?$');

class _RecordVisitScreenState extends ConsumerState<RecordVisitScreen> {
  DateTime _visitedAt = DateTime.now();
  String? _error;
  bool _loading = false;
  String? _idempotencyKey;
  List<SalonService> _services = const [];
  String? _serviceId;
  bool _loadingServices = false;
  final _amount = TextEditingController();

  bool get _canCaptureSale {
    final role = ref.read(authControllerProvider).user?.role;
    return role == 'OWNER' || role == 'MANAGER';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_canCaptureSale) {
        _loadServices();
      }
    });
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  String _newIdempotencyKey() {
    final rnd = Random.secure();
    final bytes = List<int>.generate(16, (_) => rnd.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  String _normalizedAmount() {
    return _amount.text.replaceAll(',', '').replaceAll(' ', '').trim();
  }

  Future<void> _loadServices() async {
    setState(() {
      _loadingServices = true;
      _error = null;
    });
    try {
      final page = await ref.read(serviceRepositoryProvider).list();
      if (!mounted) {
        return;
      }
      final active = page.items
          .where((item) => item.status == 'ACTIVE')
          .toList();
      setState(() {
        _services = active;
        _serviceId = active.any((item) => item.id == _serviceId)
            ? _serviceId
            : (active.isEmpty ? null : active.first.id);
        _loadingServices = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = friendlyError(error);
        _loadingServices = false;
      });
    }
  }

  Future<void> _pickDate() async {
    final selected = await showJalaliDatePicker(
      context: context,
      initialDate: _visitedAt,
      firstDate: DateTime(2018),
      lastDate: DateTime.now(),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _visitedAt = replaceLocalDateKeepingTime(_visitedAt, selected);
      _idempotencyKey = null;
    });
  }

  Future<void> _pickTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_visitedAt),
    );
    if (time == null || !mounted) {
      return;
    }
    setState(() {
      _visitedAt = DateTime(
        _visitedAt.year,
        _visitedAt.month,
        _visitedAt.day,
        time.hour,
        time.minute,
      );
      _idempotencyKey = null;
    });
  }

  Future<void> _save() async {
    if (_loading) {
      return;
    }
    final captureSale = _canCaptureSale;
    final amount = _normalizedAmount();
    final wantsSale = captureSale && amount.isNotEmpty && amount != '0' && amount != '0.0' && amount != '0.00';
    if (wantsSale && !_amountPattern.hasMatch(amount)) {
      setState(() => _error = AppStrings.amountInvalid);
      return;
    }
    if (wantsSale && _serviceId == null) {
      setState(() => _error = AppStrings.selectActiveService);
      return;
    }

    _loading = true;
    setState(() {
      _error = null;
    });
    try {
      _idempotencyKey ??= _newIdempotencyKey();
      if (wantsSale) {
        await ref.read(visitRepositoryProvider).recordCompletedWithSale(
              customerId: widget.customerId,
              visitedAt: _visitedAt,
              serviceId: _serviceId!,
              amount: amount,
              idempotencyKey: _idempotencyKey!,
            );
      } else {
        await ref.read(visitRepositoryProvider).record(
              customerId: widget.customerId,
              visitedAt: _visitedAt,
              idempotencyKey: _idempotencyKey!,
            );
      }
      if (!mounted) {
        return;
      }
      context.pop(true);
    } catch (error) {
      setState(() => _error = friendlyError(error));
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Widget _serviceSelector() {
    if (_loadingServices) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null && _services.isEmpty) {
      return ErrorView(message: _error!, onRetry: _loadServices);
    }
    if (_services.isEmpty) {
      final isOwner = ref.read(authControllerProvider).user?.role == 'OWNER';
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const EmptyStateView(
            title: AppStrings.noActiveServices,
            body: AppStrings.noActiveServicesBody,
          ),
          if (isOwner) ...[
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => context.push('/profile/services'),
              child: const Text(AppStrings.manageServices),
            ),
          ],
        ],
      );
    }
    return InputDecorator(
      decoration: const InputDecoration(labelText: AppStrings.serviceLabel),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _serviceId,
          isExpanded: true,
          items: _services
              .map(
                (service) => DropdownMenuItem(
                  value: service.id,
                  child: Text(service.name),
                ),
              )
              .toList(),
          onChanged: _loading
              ? null
              : (value) => setState(() => _serviceId = value),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final captureSale = _canCaptureSale;
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.recordVisit)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            AppStrings.recordVisitHint,
            style: TextStyle(height: 1.65),
          ),
          const SizedBox(height: 24),
          ListTile(
            key: const Key('visit-date-tile'),
            title: const Text(AppStrings.visitDate),
            subtitle: Text(formatJalaliPrettyDate(_visitedAt)),
            trailing: const Icon(Icons.event),
            onTap: _pickDate,
          ),
          ListTile(
            key: const Key('visit-time-tile'),
            title: const Text(AppStrings.visitTime),
            subtitle: Text(
              toPersianDigits(
                '${_visitedAt.hour.toString().padLeft(2, '0')}:${_visitedAt.minute.toString().padLeft(2, '0')}',
              ),
            ),
            trailing: const Icon(Icons.schedule),
            onTap: _pickTime,
          ),
          if (captureSale) ...[
            const SizedBox(height: 8),
            _serviceSelector(),
            if (_services.isNotEmpty) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _amount,
                enabled: !_loading,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(
                  labelText: AppStrings.amountReceived,
                ),
              ),
              const SizedBox(height: 8),
              const Text(AppStrings.complimentaryHint),
            ],
          ],
          if (_error != null &&
              !(captureSale && _services.isEmpty && !_loadingServices)) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 24),
          AppButton(
            label: AppStrings.saveCompletedVisit,
            onPressed: _loading ? null : _save,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}

class _VipCountSheet extends StatelessWidget {
  const _VipCountSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(AppStrings.vipChooseCount),
            const SizedBox(height: 12),
            for (final count in [30, 50, 100])
              ListTile(
                title: Text('$count'),
                onTap: () => Navigator.of(context).pop(count),
              ),
          ],
        ),
      ),
    );
  }
}

