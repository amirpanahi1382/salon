import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

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
      final items = await ref
          .read(customerRepositoryProvider)
          .list(query: _search.text);
      if (!mounted) {
        return;
      }
      setState(() {
        _items = items;
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
      appBar: AppBar(title: const Text(AppStrings.customers)),
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
                                action: FilledButton(
                                  onPressed: () =>
                                      context.push('/customers/new'),
                                  child: const Text(AppStrings.addCustomer),
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
                                onTap: () =>
                                    context.push('/customers/${customer.id}'),
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

  Future<void> _save() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (widget.customer == null) {
        final created = await ref
            .read(customerRepositoryProvider)
            .create(
              firstName: _first.text,
              lastName: _last.text,
              phoneNumber: _phone.text,
            );
        if (!mounted) {
          return;
        }
        context.go('/customers/${created.id}');
      } else {
        await ref
            .read(customerRepositoryProvider)
            .update(
              id: widget.customer!.id,
              firstName: _first.text,
              lastName: _last.text,
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
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.customer == null
              ? AppStrings.addCustomer
              : AppStrings.editCustomer,
        ),
      ),
      body: ListView(
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
            label: AppStrings.save,
            onPressed: _save,
            loading: _loading,
          ),
        ],
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
      if (!mounted) {
        return;
      }
      setState(() {
        _customer = customer;
        _intelligence = intelligence;
        _visits = visits;
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
    final dateFormat = DateFormat.yMMMd().add_jm();
    final canEdit = ref.watch(authControllerProvider).user?.role != 'STAFF';
    return Scaffold(
      appBar: AppBar(
        title: Text(customer.fullName),
        actions: [
          if (canEdit)
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
                  Text(customer.phoneNumber),
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
                    Text(intelligence.explanation),
                    if (intelligence.opportunities.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        AppStrings.recommended,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Text(intelligence.opportunities.first.recommendedAction),
                      const SizedBox(height: 8),
                      const Text(
                        AppStrings.recommendationNote,
                        style: TextStyle(fontSize: 12),
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
            Text(
              AppStrings.visitHistory,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (_visits.isEmpty)
              const EmptyStateView(
                title: AppStrings.noVisits,
                body: 'Record a completed visit when she has been in.',
              )
            else
              ..._visits.map(
                (visit) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(dateFormat.format(visit.visitedAt.toLocal())),
                  subtitle: const Text('Completed visit'),
                ),
              ),
          ],
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

class _RecordVisitScreenState extends ConsumerState<RecordVisitScreen> {
  DateTime _visitedAt = DateTime.now();
  String? _error;
  bool _loading = false;

  Future<void> _pick() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _visitedAt,
      firstDate: DateTime(2018),
      lastDate: DateTime.now(),
    );
    if (date == null || !mounted) {
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_visitedAt),
    );
    if (time == null) {
      return;
    }
    setState(() {
      _visitedAt = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  Future<void> _save() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(visitRepositoryProvider)
          .record(customerId: widget.customerId, visitedAt: _visitedAt);
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

  @override
  Widget build(BuildContext context) {
    final label = DateFormat.yMMMd().add_jm().format(_visitedAt);
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.recordVisit)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            'Record a completed historical visit. This is not a booking or appointment.',
          ),
          const SizedBox(height: 24),
          ListTile(
            title: const Text(AppStrings.visitDate),
            subtitle: Text(label),
            trailing: const Icon(Icons.event),
            onTap: _pick,
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
            label: AppStrings.recordVisit,
            onPressed: _save,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}
