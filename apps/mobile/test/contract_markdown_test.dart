import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/features/agreement/contract_markdown.dart';

void main() {
  testWidgets('renders headings and emphasis without raw markdown markers', (tester) async {
    const source = '''# قرارداد ارائهٔ خدمات

## مادهٔ ۱ ـ طرفین قرارداد

این قرارداد شامل **۵۰۰ ارسال قابل‌احتساب** است.
''';
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ContractMarkdownView(source: source),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('قرارداد ارائهٔ خدمات'), findsOneWidget);
    expect(find.textContaining('مادهٔ ۱ ـ طرفین قرارداد'), findsOneWidget);
    expect(find.textContaining('۵۰۰ ارسال قابل‌احتساب'), findsOneWidget);
    expect(find.textContaining('#'), findsNothing);
    expect(find.textContaining('**'), findsNothing);

    bool hasBold = false;
    void walk(InlineSpan span) {
      if (span is TextSpan) {
        if (span.style?.fontWeight == FontWeight.w700 && span.text == '۵۰۰ ارسال قابل‌احتساب') {
          hasBold = true;
        }
        for (final child in span.children ?? const <InlineSpan>[]) {
          walk(child);
        }
      }
    }

    for (final rich in tester.widgetList<RichText>(find.byType(RichText))) {
      walk(rich.text);
    }
    expect(hasBold, isTrue);
  });
}
