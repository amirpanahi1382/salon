import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/theme/app_tokens.dart';
import 'package:salon_mobile/core/widgets/onboarding_progress.dart';

Future<void> _pump(WidgetTester tester, OnboardingStage stage) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: OnboardingProgress(stage: stage)),
    ),
  );
}

Text _label(WidgetTester tester, int index) {
  return tester.widget<Text>(find.byKey(onboardingStepLabelKey(index)));
}

void main() {
  testWidgets('registration highlights only the first stage', (tester) async {
    await _pump(tester, OnboardingStage.registration);

    expect(
      tester.widget<OnboardingProgress>(find.byType(OnboardingProgress)).stage,
      OnboardingStage.registration,
    );
    expect(find.byKey(onboardingStepLabelKey(0)), findsOneWidget);
    expect(find.text('ثبت‌نام'), findsOneWidget);
    expect(find.text('تأیید قوانین'), findsOneWidget);
    expect(find.text('تسویه و فعال‌سازی'), findsOneWidget);
    expect(_label(tester, 0).style?.color, AppTokens.accent);
    expect(_label(tester, 0).style?.fontWeight, FontWeight.w700);
    expect(_label(tester, 1).style?.color, AppTokens.textSecondary);
    expect(_label(tester, 2).style?.color, AppTokens.textSecondary);
    expect(find.byIcon(Icons.check), findsNothing);
    expect(
      Directionality.of(tester.element(find.byKey(onboardingStepLabelKey(0)))),
      TextDirection.rtl,
    );
    expect(
      find.descendant(
        of: find.byKey(onboardingProgressKey),
        matching: find.byType(GestureDetector),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: find.byKey(onboardingProgressKey),
        matching: find.byType(InkWell),
      ),
      findsNothing,
    );
  });

  testWidgets('agreement marks registration complete and agreement current', (
    tester,
  ) async {
    await _pump(tester, OnboardingStage.agreement);

    expect(find.byIcon(Icons.check), findsOneWidget);
    expect(_label(tester, 0).style?.color, onboardingCurrentGreen);
    expect(_label(tester, 0).style?.fontWeight, FontWeight.w700);
    expect(_label(tester, 1).style?.color, AppTokens.accent);
    expect(_label(tester, 1).style?.fontWeight, FontWeight.w700);
    expect(_label(tester, 2).style?.color, AppTokens.textSecondary);
  });

  testWidgets(
    'activation marks the first two stages complete and activation current',
    (tester) async {
      await _pump(tester, OnboardingStage.activation);

      expect(find.byIcon(Icons.check), findsNWidgets(2));
      expect(_label(tester, 0).style?.color, onboardingCurrentGreen);
      expect(_label(tester, 1).style?.color, onboardingCurrentGreen);
      expect(_label(tester, 2).style?.color, AppTokens.accent);
      expect(_label(tester, 2).style?.fontWeight, FontWeight.w700);
    },
  );
}
