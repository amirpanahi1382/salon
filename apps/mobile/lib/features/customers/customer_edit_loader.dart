import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/models/models.dart';
import 'customer_screens.dart';

class CustomerEditLoader extends ConsumerStatefulWidget {
  const CustomerEditLoader({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<CustomerEditLoader> createState() => _CustomerEditLoaderState();
}

class _CustomerEditLoaderState extends ConsumerState<CustomerEditLoader> {
  Customer? _customer;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final customer = await ref
          .read(customerRepositoryProvider)
          .getById(widget.customerId);
      if (!mounted) {
        return;
      }
      setState(() => _customer = customer);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        body: ErrorView(message: friendlyError(_error!), onRetry: _load),
      );
    }
    if (_customer == null) {
      return const Scaffold(body: LoadingView());
    }
    return CustomerFormScreen(customer: _customer);
  }
}
