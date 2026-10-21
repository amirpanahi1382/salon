import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

enum OnboardingStage { registration, agreement, activation }

const onboardingStageLabels = <String>[
  'ثبت‌نام',
  'تأیید قوانین',
  'تسویه و فعال‌سازی',
];

const onboardingCurrentGreen = Color(0xFF81C784);
const onboardingProgressKey = Key('onboarding-progress');

Key onboardingStepKey(int index) => Key('onboarding-step-$index');
Key onboardingStepCircleKey(int index) => Key('onboarding-step-circle-$index');
Key onboardingStepLabelKey(int index) => Key('onboarding-step-label-$index');

class OnboardingProgress extends StatelessWidget {
  const OnboardingProgress({super.key, required this.stage});

  final OnboardingStage stage;

  @override
  Widget build(BuildContext context) {
    final current = stage.index;
    return Semantics(
      key: onboardingProgressKey,
      container: true,
      label: 'مراحل راه‌اندازی سالن',
      explicitChildNodes: true,
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 16, 12, 12),
          decoration: BoxDecoration(
            color: AppTokens.surfaceGlass,
            borderRadius: BorderRadius.circular(AppTokens.radiusLg),
            border: Border.all(color: AppTokens.line),
            boxShadow: [
              BoxShadow(
                color: AppTokens.accentSecondary.withValues(alpha: 0.10),
                blurRadius: 24,
                spreadRadius: -8,
              ),
            ],
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final connectorInset = constraints.maxWidth / 6;
              return Stack(
                children: [
                  PositionedDirectional(
                    top: 22,
                    start: connectorInset,
                    end: connectorInset,
                    child: Row(
                      children: [
                        Expanded(child: _Connector(active: current > 0)),
                        Expanded(child: _Connector(active: current > 1)),
                      ],
                    ),
                  ),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (
                        var index = 0;
                        index < onboardingStageLabels.length;
                        index += 1
                      )
                        Expanded(
                          child: _Step(
                            index: index,
                            label: onboardingStageLabels[index],
                            current: index == current,
                            complete: index < current,
                          ),
                        ),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.index,
    required this.label,
    required this.current,
    required this.complete,
  });

  final int index;
  final String label;
  final bool current;
  final bool complete;

  @override
  Widget build(BuildContext context) {
    final active = current || complete;
    final color = complete
        ? onboardingCurrentGreen
        : current
        ? AppTokens.accent
        : AppTokens.textSecondary;
    final status = current
        ? '، مرحله فعلی'
        : complete
        ? '، انجام شده'
        : '';
    return Semantics(
      key: onboardingStepKey(index),
      container: true,
      label: 'مرحله ${index + 1} از ۳، $label$status',
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              key: onboardingStepCircleKey(index),
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: complete
                    ? onboardingCurrentGreen
                    : current
                    ? AppTokens.accentSecondary
                    : AppTokens.surfaceElevated,
                border: Border.all(
                  color: complete
                      ? onboardingCurrentGreen
                      : current
                      ? AppTokens.accent
                      : AppTokens.line,
                  width: current ? 2 : 1.2,
                ),
              ),
              child: Center(
                child: complete
                    ? const Icon(
                        Icons.check,
                        size: 22,
                        color: AppTokens.onAccent,
                      )
                    : Icon(
                        _stageIcon(index),
                        size: 21,
                        color: current
                            ? AppTokens.textPrimary
                            : AppTokens.textSecondary,
                      ),
              ),
            ),
            const SizedBox(height: AppTokens.space8),
            Text(
              'مرحله ${index + 1}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: active
                    ? color.withValues(alpha: 0.85)
                    : AppTokens.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w500,
                height: 1.2,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              key: onboardingStepLabelKey(index),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: current || complete
                    ? FontWeight.w700
                    : FontWeight.w500,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _stageIcon(int index) => switch (index) {
    0 => Icons.person_add_alt_1_rounded,
    1 => Icons.description_outlined,
    _ => Icons.account_balance_wallet_outlined,
  };
}

class _Connector extends StatelessWidget {
  const _Connector({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 3,
      decoration: BoxDecoration(
        color: active ? onboardingCurrentGreen : AppTokens.line,
        borderRadius: BorderRadius.circular(99),
        boxShadow: active
            ? [
                BoxShadow(
                  color: onboardingCurrentGreen.withValues(alpha: 0.28),
                  blurRadius: 8,
                ),
              ]
            : null,
      ),
    );
  }
}
