import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
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
  String? _nextCursor;
  bool _hasMore = false;
  Object? _error;
  bool _loading = true;
  bool _loadingMore = false;
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
      _nextCursor = null;
      _hasMore = false;
    });
    try {
      final page = await ref
          .read(visitRepositoryProvider)
          .list(customerId: _customer?.id, day: _day);
      if (!mounted) {
        return;
      }
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
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
      final page = await ref.read(visitRepositoryProvider).list(
        customerId: _customer?.id,
        day: _day,
        cursor: _nextCursor,
      );
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
    return formatJalaliPrettyDate(selected);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(AppStrings.visitsListTitle),
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
                alignment: AlignmentDirectional.centerStart,
                child: Text(
                  '${toPersianDigits(_items.length.toString())} ${AppStrings.visitCountLabel}',
                ),
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
                            primary: true,
                            itemCount: _items.length + (_hasMore ? 1 : 0),
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              if (index >= _items.length) {
                                return PagedFooter(loading: _loadingMore);
                              }
                              final visit = _items[index];
                              return _VisitEventRow(
                                visit: visit,
                                dateLabel: formatJalaliDateTime(visit.visitedAt),
                                onDelete: _canDelete
                                    ? () => _delete(visit)
                                    : null,
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

class _VisitEventRow extends StatelessWidget {
  const _VisitEventRow({
    required this.visit,
    required this.dateLabel,
    this.onDelete,
  });

  final Visit visit;
  final String dateLabel;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(visit.customerName, style: theme.textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(visit.serviceLabel),
                const SizedBox(height: 2),
                Text(visit.amountLabel, textDirection: TextDirection.ltr),
                const SizedBox(height: 2),
                Text(dateLabel, style: theme.textTheme.bodySmall),
              ],
            ),
          ),
          if (onDelete != null)
            IconButton(
              tooltip: AppStrings.deleteVisit,
              onPressed: onDelete,
              icon: const Icon(Icons.delete_outline),
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
  String? _nextCursor;
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;

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
      _nextCursor = null;
      _hasMore = false;
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
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _loading = false);
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
                  : PagedNotificationListener(
                      hasMore: _hasMore,
                      loading: _loading || _loadingMore,
                      onLoadMore: _loadMore,
                      child: ListView(
                      primary: true,
                      children: [
                        ListTile(
                          title: const Text(AppStrings.allCustomers),
                          onTap: () => Navigator.pop(context, 'all'),
                        ),
                        ..._items.map(
                          (customer) => ListTile(
                            title: Text(customer.fullName),
                            subtitle: LtrText(customer.phoneNumber),
                            onTap: () => Navigator.pop(context, customer),
                          ),
                        ),
                        if (_hasMore) PagedFooter(loading: _loadingMore),
                      ],
                    ),
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
