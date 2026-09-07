import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shamsi_date/shamsi_date.dart';
import 'package:salon_mobile/shared/jalali.dart';
import 'package:salon_mobile/shared/jalali_date_picker.dart';

void main() {
  testWidgets('Jalali picker shows Persian month names and returns the selected day', (
    tester,
  ) async {
    Jalali? chosen;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                chosen = await showJalaliDatePicker(
                  context: context,
                  initialDate: DateTime(2026, 9, 7, 14, 30),
                  firstDate: DateTime(2018),
                  lastDate: DateTime(2026, 9, 7),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('شهریور ۱۴۰۵'), findsOneWidget);
    expect(find.text('ش'), findsOneWidget);
    expect(find.text(toPersianDigits('16')), findsWidgets);
    await tester.tap(find.text(toPersianDigits('16')));
    await tester.tap(find.text('تأیید'));
    await tester.pumpAndSettle();
    expect(chosen, isNotNull);
    expect(chosen!.year, 1405);
    expect(chosen!.month, 6);
    expect(chosen!.day, 16);
    final local = jalaliWithTimeToLocal(chosen!, 14, 30);
    expect(local.year, 2026);
    expect(local.month, 9);
    expect(local.day, 7);
    expect(local.hour, 14);
    expect(local.minute, 30);
  });
}
