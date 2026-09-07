import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'service_validation.dart';

class ServiceManagementScreen extends ConsumerStatefulWidget {
  const ServiceManagementScreen({super.key});

  @override
  ConsumerState<ServiceManagementScreen> createState() =>
      _ServiceManagementScreenState();
}

class _ServiceManagementScreenState
    extends ConsumerState<ServiceManagementScreen> {
  List<SalonService> _items = const [];
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
      final page = await ref
          .read(serviceRepositoryProvider)
          .list(includeInactive: true);
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

  Future<void> _toggle(SalonService service) async {
    if (service.status == 'ACTIVE') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text(AppStrings.deactivateServiceTitle),
          content: const Text(AppStrings.deactivateServiceBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text(AppStrings.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text(AppStrings.deactivate),
            ),
          ],
        ),
      );
      if (confirmed != true) {
        return;
      }
      await _setStatus(service, 'INACTIVE');
      return;
    }
    await _setStatus(service, 'ACTIVE');
  }

  Future<void> _setStatus(SalonService service, String status) async {
    try {
      await ref
          .read(serviceRepositoryProvider)
          .update(id: service.id, status: status);
      if (!mounted) {
        return;
      }
      await _load();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(friendlyError(error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.manageServices)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await context.push<bool>('/profile/services/new');
          if (created == true) {
            _load();
          }
        },
        icon: const Icon(Icons.add),
        label: const Text(AppStrings.addService),
      ),
      body: _loading
          ? const LoadingView()
          : _error != null
          ? ErrorView(message: friendlyError(_error!), onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: _items.isEmpty
                  ? ListView(
                      children: const [
                        SizedBox(height: 48),
                        EmptyStateView(
                          title: AppStrings.noServices,
                          body: AppStrings.addService,
                        ),
                      ],
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                      itemCount: _items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final service = _items[index];
                        final active = service.status == 'ACTIVE';
                        return ListTile(
                          title: Text(service.name),
                          subtitle: Text(
                            active
                                ? AppStrings.serviceActive
                                : AppStrings.serviceInactive,
                          ),
                          trailing: PopupMenuButton<String>(
                            onSelected: (value) async {
                              if (value == 'edit') {
                                final updated = await context.push<bool>(
                                  '/profile/services/${service.id}/edit',
                                  extra: service,
                                );
                                if (updated == true) {
                                  _load();
                                }
                              }
                              if (value == 'status') {
                                await _toggle(service);
                              }
                            },
                            itemBuilder: (context) => [
                              const PopupMenuItem(
                                value: 'edit',
                                child: Text(AppStrings.editService),
                              ),
                              PopupMenuItem(
                                value: 'status',
                                child: Text(
                                  active
                                      ? AppStrings.deactivate
                                      : AppStrings.activate,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}

class ServiceFormScreen extends ConsumerStatefulWidget {
  const ServiceFormScreen({super.key, this.service});

  final SalonService? service;

  @override
  ConsumerState<ServiceFormScreen> createState() => _ServiceFormScreenState();
}

class _ServiceFormScreenState extends ConsumerState<ServiceFormScreen> {
  late final TextEditingController _name;
  String? _error;
  bool _loading = false;

  bool get _isEdit => widget.service != null;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.service?.name ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_loading) {
      return;
    }
    final nameError = ServiceFieldValidation.nameError(_name.text);
    if (nameError != null) {
      setState(() => _error = nameError);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_isEdit) {
        await ref
            .read(serviceRepositoryProvider)
            .update(id: widget.service!.id, name: _name.text.trim());
      } else {
        await ref.read(serviceRepositoryProvider).create(_name.text.trim());
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _isEdit ? AppStrings.editService : AppStrings.addService,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (_isEdit) ...[
            Text(AppStrings.currentServiceName),
            const SizedBox(height: 4),
            Text(
              widget.service!.name,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 24),
          ],
          TextField(
            controller: _name,
            enabled: !_loading,
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(
              labelText: _isEdit
                  ? AppStrings.newServiceName
                  : AppStrings.serviceName,
            ),
            onSubmitted: (_) => _save(),
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
            onPressed: _loading ? null : _save,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}
