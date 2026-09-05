import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/shared/labels.dart';

void main() {
  test('status labels stay user-facing', () {
    expect(statusLabel('AT_RISK'), 'At risk');
    expect(statusLabel('NEW'), 'New customer');
    expect(statusLabel('SOMETHING_FUTURE'), 'Unknown status');
  });

  test('opportunity and signal labels have safe fallbacks', () {
    expect(opportunityLabel('REACTIVATION'), 'Reactivation');
    expect(opportunityLabel('FUTURE_TYPE'), 'Opportunity');
    expect(signalLabel('FREQUENT'), 'Frequent visitor');
    expect(signalLabel('NEW_SIGNAL'), 'Signal');
  });
}
