import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

class CustomerImportScreen extends ConsumerStatefulWidget {
  const CustomerImportScreen({super.key});

  @override
  ConsumerState<CustomerImportScreen> createState() =>
      _CustomerImportScreenState();
}

class _CustomerImportScreenState extends ConsumerState<CustomerImportScreen> {
  String? _filename;
  List<int>? _bytes;
  CustomerImportResult? _result;
  Object? _error;
  bool _loading = false;
  bool _downloadingTemplate = false;

  Future<void> _pick() async {
    setState(() {
      _error = null;
      _result = null;
    });
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['xlsx'],
    );
    if (file == null) {
      return;
    }
    final bytes = await file.readAsBytes();
    setState(() {
      _filename = file.name;
      _bytes = bytes;
    });
  }

  Future<void> _downloadTemplate() async {
    setState(() {
      _downloadingTemplate = true;
      _error = null;
    });
    try {
      final bytes = await ref
          .read(customerRepositoryProvider)
          .downloadImportTemplate();
      await FilePicker.saveFile(
        dialogTitle: AppStrings.saveTemplate,
        fileName: 'customer-import-template.xlsx',
        type: FileType.custom,
        allowedExtensions: const ['xlsx'],
        bytes: Uint8List.fromList(bytes),
        mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (error) {
      setState(() => _error = error);
    } finally {
      if (mounted) {
        setState(() => _downloadingTemplate = false);
      }
    }
  }

  Future<void> _import() async {
    final bytes = _bytes;
    final filename = _filename;
    if (bytes == null || filename == null) {
      setState(() => _error = 'Select an Excel .xlsx file first.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _result = null;
    });
    try {
      final result = await ref
          .read(customerRepositoryProvider)
          .importFromExcel(bytes: bytes, filename: filename);
      if (!mounted) {
        return;
      }
      setState(() {
        _result = result;
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
    final result = _result;
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.importCustomers)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            'Import your salon customers from Excel. Existing customers are never overwritten.',
          ),
          const SizedBox(height: 8),
          const Text(
            'Required columns: Name, Phone. Phone must be exactly 11 digits and start with 09, for example 09121111111. Maximum 5,000 rows and 2 MB.',
            style: TextStyle(color: Color(0xFF6F645C)),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: _downloadingTemplate ? null : _downloadTemplate,
            icon: _downloadingTemplate
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_outlined),
            label: const Text(AppStrings.downloadTemplate),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _loading ? null : _pick,
            icon: const Icon(Icons.upload_file_outlined),
            label: const Text(AppStrings.selectExcelFile),
          ),
          if (_filename != null) ...[
            const SizedBox(height: 16),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _filename!,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Text('${_bytes?.length ?? 0} bytes'),
                ],
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(
              friendlyError(_error!),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 24),
          AppButton(
            label: AppStrings.importFromExcel,
            onPressed: _import,
            loading: _loading,
          ),
          if (result != null) ...[
            const SizedBox(height: 32),
            Text(
              AppStrings.importComplete,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text('${result.totalRows} ${AppStrings.rowsProcessed}'),
            const SizedBox(height: 16),
            Text('${result.imported} ${AppStrings.importedCount}'),
            Text('${result.skipped} ${AppStrings.skippedCount}'),
            Text('${result.failed} ${AppStrings.failedCount}'),
            if (result.skippedRows.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text(
                AppStrings.skipped,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ...result.skippedRows.map(
                (row) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${AppStrings.row} ${row.row}'),
                  subtitle: Text(importStatusLabel(row.status)),
                ),
              ),
            ],
            if (result.failedRows.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                AppStrings.failed,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ...result.failedRows.map(
                (row) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${AppStrings.row} ${row.row}'),
                  subtitle: Text(
                    row.errors.isEmpty
                        ? importStatusLabel(row.status)
                        : row.errors.join('\n'),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text(AppStrings.done),
            ),
          ],
        ],
      ),
    );
  }
}
