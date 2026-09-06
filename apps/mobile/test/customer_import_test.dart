import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

void main() {
  test('parses a mixed Excel import result without requiring customer PII', () {
    final result = CustomerImportResult.fromJson({
      'totalRows': 5,
      'imported': 2,
      'skipped': 2,
      'failed': 1,
      'results': [
        {'row': 2, 'status': 'IMPORTED'},
        {'row': 3, 'status': 'ALREADY_EXISTS'},
        {'row': 4, 'status': 'DUPLICATE_IN_FILE'},
        {
          'row': 5,
          'status': 'INVALID',
          'errors': ['Phone is invalid'],
        },
        {'row': 6, 'status': 'IMPORTED'},
      ],
    });

    expect(result.totalRows, 5);
    expect(result.imported, 2);
    expect(result.skipped, 2);
    expect(result.failed, 1);
    expect(result.skippedRows, hasLength(2));
    expect(result.failedRows.single.errors, ['Phone is invalid']);
    expect(importStatusLabel('ALREADY_EXISTS'), 'Already exists');
    expect(importStatusLabel('DUPLICATE_IN_FILE'), 'Duplicate in file');
  });

  test('file too large uses a friendly message', () {
    expect(
      const ApiException(
        statusCode: 413,
        code: 'VALIDATION_ERROR',
        message: 'too big',
      ).userMessage,
      'The Excel file is too large.',
    );
  });
}
