import 'package:flutter/material.dart';

import '../../core/theme/app_tokens.dart';

enum DashboardAccent { copper, purple, green }

extension DashboardAccentColor on DashboardAccent {
  Color get color => switch (this) {
    DashboardAccent.copper => AppTokens.accent,
    DashboardAccent.purple => AppTokens.accentSecondary,
    DashboardAccent.green => AppTokens.success,
  };
}

/// Dashboard-only backdrop. The rest of the app keeps the shared AppBackdrop.
///
/// Painted with gradients and a few bezier paths only: no image assets, blur
/// filters, or animation, and the layer never receives pointer events.
class DashboardBackdrop extends StatelessWidget {
  const DashboardBackdrop({super.key});

  @override
  Widget build(BuildContext context) {
    return const IgnorePointer(
      child: RepaintBoundary(
        child: CustomPaint(
          painter: _DashboardBackdropPainter(),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _DashboardBackdropPainter extends CustomPainter {
  const _DashboardBackdropPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xD90B090F), Color(0xC9160D18), Color(0xD90B090F)],
        ).createShader(rect),
    );

    _radial(
      canvas,
      rect,
      const Alignment(0.95, -0.92),
      1.0,
      AppTokens.accentSecondary.withValues(alpha: 0.36),
    );
    _radial(
      canvas,
      rect,
      const Alignment(-0.82, -0.92),
      0.86,
      AppTokens.accent.withValues(alpha: 0.30),
    );
    _radial(
      canvas,
      rect,
      const Alignment(-1.05, 0.82),
      1.05,
      AppTokens.accentDeep.withValues(alpha: 0.28),
    );
    _radial(
      canvas,
      rect,
      const Alignment(0.92, 1.02),
      0.82,
      AppTokens.accent.withValues(alpha: 0.18),
    );

    final upperBand = Path()
      ..moveTo(-size.width * 0.24, size.height * 0.09)
      ..cubicTo(
        size.width * 0.16,
        -size.height * 0.02,
        size.width * 0.48,
        size.height * 0.22,
        size.width * 0.78,
        size.height * 0.20,
      )
      ..cubicTo(
        size.width * 0.58,
        size.height * 0.38,
        size.width * 0.20,
        size.height * 0.42,
        -size.width * 0.06,
        size.height * 0.29,
      )
      ..close();
    canvas.drawPath(
      upperBand,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTokens.accent.withValues(alpha: 0.22),
            AppTokens.accentDeep.withValues(alpha: 0.08),
            Colors.transparent,
          ],
          stops: const [0, 0.55, 1],
        ).createShader(rect),
    );

    final softLayer = Path()
      ..moveTo(-size.width * 0.18, size.height * 0.30)
      ..cubicTo(
        size.width * 0.22,
        size.height * 0.20,
        size.width * 0.52,
        size.height * 0.42,
        size.width * 1.12,
        size.height * 0.35,
      )
      ..lineTo(size.width * 1.12, size.height * 0.56)
      ..cubicTo(
        size.width * 0.58,
        size.height * 0.66,
        size.width * 0.20,
        size.height * 0.46,
        -size.width * 0.18,
        size.height * 0.52,
      )
      ..close();
    canvas.drawPath(
      softLayer,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [
            AppTokens.accentSecondary.withValues(alpha: 0.10),
            Colors.transparent,
            AppTokens.accent.withValues(alpha: 0.07),
          ],
        ).createShader(rect),
    );

    final rim = Path()
      ..moveTo(-size.width * 0.2, size.height * 0.14)
      ..cubicTo(
        size.width * 0.18,
        size.height * 0.01,
        size.width * 0.50,
        size.height * 0.25,
        size.width * 0.80,
        size.height * 0.21,
      );
    canvas.drawPath(
      rim,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..shader = LinearGradient(
          colors: [
            AppTokens.accent.withValues(alpha: 0.42),
            AppTokens.accentSecondary.withValues(alpha: 0.20),
            Colors.transparent,
          ],
        ).createShader(rect),
    );
  }

  void _radial(
    Canvas canvas,
    Rect rect,
    Alignment center,
    double radius,
    Color color,
  ) {
    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: center,
          radius: radius,
          colors: [color, Colors.transparent],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(covariant _DashboardBackdropPainter oldDelegate) => false;
}

/// Translucent dashboard surface with a copper/purple edge highlight.
class DashboardGlassPanel extends StatelessWidget {
  const DashboardGlassPanel({
    super.key,
    required this.child,
    this.accent = DashboardAccent.copper,
    this.padding = const EdgeInsets.all(AppTokens.space16),
    this.radius = AppTokens.radiusLg,
    this.prominent = false,
  });

  final Widget child;
  final DashboardAccent accent;
  final EdgeInsetsGeometry padding;
  final double radius;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final accentColor = accent.color;
    final borderRadius = BorderRadius.circular(radius);
    final panel = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: borderRadius,
        gradient: LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: prominent
              ? [
                  AppTokens.surfaceElevated.withValues(alpha: 0.96),
                  const Color(0xFF251A2A).withValues(alpha: 0.92),
                  AppTokens.surface.withValues(alpha: 0.86),
                ]
              : [
                  AppTokens.surfaceElevated.withValues(alpha: 0.86),
                  AppTokens.surface.withValues(alpha: 0.74),
                ],
        ),
        boxShadow: [
          BoxShadow(
            color: accentColor.withValues(alpha: prominent ? 0.16 : 0.06),
            blurRadius: prominent ? 28 : 14,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: CustomPaint(
        foregroundPainter: _GradientBorderPainter(
          radius: radius,
          width: prominent ? 1.25 : 1,
          gradient: LinearGradient(
            begin: Alignment.topRight,
            end: Alignment.bottomLeft,
            colors: [
              accentColor.withValues(alpha: prominent ? 0.78 : 0.50),
              AppTokens.accentSecondary.withValues(
                alpha: prominent ? 0.34 : 0.16,
              ),
              AppTokens.line.withValues(alpha: 0.72),
              accentColor.withValues(alpha: prominent ? 0.38 : 0.20),
            ],
            stops: const [0, 0.38, 0.74, 1],
          ),
        ),
        child: Padding(padding: padding, child: child),
      ),
    );
    return panel;
  }
}

class _GradientBorderPainter extends CustomPainter {
  const _GradientBorderPainter({
    required this.radius,
    required this.width,
    required this.gradient,
  });

  final double radius;
  final double width;
  final Gradient gradient;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(width / 2),
      Radius.circular(radius),
    );
    canvas.drawRRect(
      rrect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = width
        ..shader = gradient.createShader(rect),
    );
  }

  @override
  bool shouldRepaint(covariant _GradientBorderPainter oldDelegate) =>
      oldDelegate.radius != radius ||
      oldDelegate.width != width ||
      oldDelegate.gradient != gradient;
}

class DashboardIconTile extends StatelessWidget {
  const DashboardIconTile({
    super.key,
    required this.icon,
    this.accent = DashboardAccent.copper,
    this.size = 44,
    this.iconSize = 22,
    this.prominent = false,
  });

  final IconData icon;
  final DashboardAccent accent;
  final double size;
  final double iconSize;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final color = accent.color;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.31),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            color.withValues(alpha: prominent ? 0.32 : 0.22),
            color.withValues(alpha: 0.06),
          ],
        ),
        border: Border.all(
          color: color.withValues(alpha: prominent ? 0.72 : 0.42),
          width: prominent ? 1.2 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: prominent ? 0.22 : 0.08),
            blurRadius: prominent ? 18 : 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Center(
        child: Icon(icon, color: color, size: iconSize),
      ),
    );
  }
}

enum DashboardTagTone { filled, outlined }

class DashboardTag extends StatelessWidget {
  const DashboardTag({
    super.key,
    required this.text,
    this.accent = DashboardAccent.copper,
    this.tone = DashboardTagTone.filled,
  });

  final String text;
  final DashboardAccent accent;
  final DashboardTagTone tone;

  @override
  Widget build(BuildContext context) {
    final color = accent.color;
    final filled = tone == DashboardTagTone.filled;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: filled
            ? color.withValues(alpha: 0.90)
            : color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: filled
            ? null
            : Border.all(color: color.withValues(alpha: 0.58)),
      ),
      child: Text(
        text,
        maxLines: 1,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: filled
              ? AppTokens.onAccent
              : Color.lerp(color, AppTokens.textPrimary, 0.38),
          fontWeight: FontWeight.w600,
          fontSize: 11,
          height: 1.2,
        ),
      ),
    );
  }
}

class DashboardChevron extends StatelessWidget {
  const DashboardChevron({super.key});

  @override
  Widget build(BuildContext context) {
    return Icon(
      Icons.chevron_left_rounded,
      size: 20,
      color: AppTokens.textSecondary.withValues(alpha: 0.72),
    );
  }
}

String formatDashboardIrr(String amount) {
  final normalized = amount.trim();
  final negative = normalized.startsWith('-');
  final unsigned = negative ? normalized.substring(1) : normalized;
  final parts = unsigned.split('.');
  final integerPart = parts.first.isEmpty ? '0' : parts.first;
  final fraction = parts.length > 1
      ? parts[1].replaceFirst(RegExp(r'0+$'), '')
      : '';
  final grouped = integerPart.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  final value = _toPersianDigits(grouped);
  final decimal = fraction.isEmpty ? '' : '.${_toPersianDigits(fraction)}';
  return '${negative ? '-' : ''}$value$decimal';
}

String _toPersianDigits(String value) {
  const western = '0123456789';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  final buffer = StringBuffer();
  for (final code in value.codeUnits) {
    final index = western.indexOf(String.fromCharCode(code));
    buffer.write(index >= 0 ? persian[index] : String.fromCharCode(code));
  }
  return buffer.toString();
}
