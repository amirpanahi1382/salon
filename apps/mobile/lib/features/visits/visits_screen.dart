import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class VisitsScreen extends ConsumerStatefulWidget {
  const VisitsScreen({super.key});

  @override
  ConsumerState<VisitsScreen> createState() => _VisitsScreenState();
}

class _VisitsScreenState extends ConsumerState<VisitsScreen> {
  DateTime? _day = DateTime.now();
  Customer? _customer;
  List<Visit> _items = const [];
  Object? _error;
  bool _loading = true;
  bool _exporting = false;

  bool get _canDelete =>
      ref.watch(authControllerProvider).user?.role != 'STAFF';

  @override
  void initState() {
    super.initState();
    _load();
  }

  DateTime _dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await ref
          .read(visitRepositoryProvider)
          .list(customerId: _customer?.id, day: _day);
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

  Future<void> _pickDate() async {
    final selected = await showDatePicker(
      context: context,
      initialDate: _day ?? DateTime.now(),
      firstDate: DateTime(2018),
      lastDate: DateTime.now(),
    );
    if (selected == null) {
      return;
    }
    setState(() => _day = _dateOnly(selected));
    await _load();
  }

  Future<void> _pickCustomer() async {
    final chosen = await showDialog<Object>(
      context: context,
      builder: (context) => const _CustomerPickerDialog(),
    );
    if (!mounted || chosen == null) {
      return;
    }
    setState(() {
      _customer = chosen is Customer ? chosen : null;
    });
    await _load();
  }

  Future<void> _clearFilters() async {
    setState(() {
      _day = null;
      _customer = null;
    });
    await _load();
  }

  Future<void> _export() async {
    if (_exporting) {
      return;
    }
    setState(() => _exporting = true);
    try {
      final bytes = await ref
          .read(visitRepositoryProvider)
          .exportExcel(customerId: _customer?.id, day: _day);
      if (!mounted) {
        return;
      }
      final saved = await ref.read(visitExcelSaverProvider)(
        bytes: Uint8List.fromList(bytes),
        fileName: 'visits.xlsx',
      );
      if (!mounted || saved == null) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(AppStrings.exportExcelSaved)),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(friendlyError(error))));
    } finally {
      if (mounted) {
        setState(() => _exporting = false);
      }
    }
  }

  Future<void> _delete(Visit visit) async {
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

  String get _dateLabel {
    if (_day == null) {
      return AppStrings.allDates;
    }
    final today = _dateOnly(DateTime.now());
    final yesterday = today.subtract(const Duration(days: 1));
    final selected = _dateOnly(_day!);
    if (selected == today) {
      return AppStrings.today;
    }
    if (selected == yesterday) {
      return AppStrings.yesterday;
    }
    return DateFormat.yMMMd().format(selected);
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat.yMMMd().add_jm();
    return Scaffold(
      appBar: AppBar(
        title: const Text(AppStrings.visits),
        actions: [
          TextButton(
            onPressed: _exporting ? null : _export,
            child: _exporting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(AppStrings.exportExcel),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilterChip(
                  label: Text(_dateLabel),
                  selected: _day != null,
                  onSelected: (_) => _pickDate(),
                ),
                FilterChip(
                  label: Text(_customer?.fullName ?? AppStrings.allCustomers),
                  selected: _customer != null,
                  onSelected: (_) => _pickCustomer(),
                ),
                TextButton(
                  onPressed: _clearFilters,
                  child: const Text(AppStrings.clearFilters),
                ),
              ],
            ),
          ),
          if (!_loading && _error == null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('${_items.length} ${AppStrings.visitCountLabel}'),
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
                                title:
                                    _day != null &&
                                        _customer == null &&
                                        _dateOnly(_day!) ==
                                            _dateOnly(DateTime.now())
                                    ? AppStrings.noVisitsToday
                                    : AppStrings.noMatchingVisits,
                                body: AppStrings.clearFilters,
                              ),
                            ],
                          )
                        : ListView.separated(
                            itemCount: _items.length,
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final visit = _items[index];
                              return ListTile(
                                title: Text(visit.customerName),
                                isThreeLine: true,
                                subtitle: Text(
                                  '${visit.serviceLabel}\n${visit.amountLabel}\n${dateFormat.format(visit.visitedAt.toLocal())}',
                                ),
                                trailing: _canDelete
                                    ? IconButton(
                                        tooltip: AppStrings.deleteVisit,
                                        onPressed: () => _delete(visit),
                                        icon: const Icon(Icons.delete_outline),
                                      )
                                    : null,
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

class _CustomerPickerDialog extends ConsumerStatefulWidget {
  const _CustomerPickerDialog();

  @override
  ConsumerState<_CustomerPickerDialog> createState() =>
      _CustomerPickerDialogState();
}

class _CustomerPickerDialogState extends ConsumerState<_CustomerPickerDialog> {
  final _search = TextEditingController();
  List<Customer> _items = const [];
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
    setState(() => _loading = true);
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
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text(AppStrings.customers),
      content: SizedBox(
        width: 420,
        height: 420,
        child: Column(
          children: [
            TextField(
              controller: _search,
              decoration: const InputDecoration(
                labelText: AppStrings.searchCustomers,
              ),
              onSubmitted: (_) => _load(),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _loading
                  ? const LoadingView()
                  : ListView(
                      children: [
                        ListTile(
                          title: const Text(AppStrings.allCustomers),
                          onTap: () => Navigator.pop(context, 'all'),
                        ),
                        ..._items.map(
                          (customer) => ListTile(
                            title: Text(customer.fullName),
                            subtitle: Text(customer.phoneNumber),
                            onTap: () => Navigator.pop(context, customer),
                          ),
                        ),
                      ],
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text(AppStrings.cancel),
        ),
      ],
    );
  }
}
