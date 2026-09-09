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
import 'customer_validation.dart';

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  final _search = TextEditingController();
  List<Customer> _items = const [];
  Object? _error;
  bool _loading = true;

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
    });
    try {
      final page = await ref
          .read(customerRepositoryProvider)
          .list(query: _search.text);
      if (!mounted) {
        return;
      }
      setState(() {
        _items = page.items;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(AppStrings.customers),
        actions: [
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
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await context.push<bool>('/customers/new');
          if (created == true) {
            _load();
          }
        },
        label: const Text(AppStrings.addCustomer),
        icon: const Icon(Icons.add),
      ),
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
          Expanded(
            child: _loading
                ? const LoadingView()
                : _error != null
                ? ErrorView(message: friendlyError(_error!), onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _items.isEmpty
                        ? ListView(
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
                            itemCount: _items.length,
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final customer = _items[index];
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
        child: ListView(
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
          ],
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

