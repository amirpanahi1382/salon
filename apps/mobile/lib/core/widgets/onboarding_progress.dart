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
        child: Padding(
          padding: const EdgeInsets.only(
            top: AppTokens.space8,
            bottom: AppTokens.space12,
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final connectorInset = constraints.maxWidth / 6;
              return Stack(
                children: [
                  PositionedDirectional(
                    top: 12,
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
    final color = active ? onboardingCurrentGreen : AppTokens.textSecondary;
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
              width: 26,
              height: 26,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: current
                    ? onboardingCurrentGreen
                    : complete
                    ? onboardingCurrentGreen.withValues(alpha: 0.16)
                    : Colors.transparent,
                border: Border.all(
                  color: active ? onboardingCurrentGreen : AppTokens.line,
                  width: current ? 2 : 1,
                ),
              ),
              child: Center(
                child: complete
                    ? const Icon(
                        Icons.check,
                        size: 15,
                        color: onboardingCurrentGreen,
                      )
                    : Text(
                        '${index + 1}',
                        style: TextStyle(
                          color: current
                              ? AppTokens.bg
                              : AppTokens.textSecondary,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          height: 1,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: AppTokens.space4),
            Text(
              label,
              key: onboardingStepLabelKey(index),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Connector extends StatelessWidget {
  const _Connector({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 2,
      color: active
          ? onboardingCurrentGreen.withValues(alpha: 0.55)
          : AppTokens.line,
    );
  }
}
