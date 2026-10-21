import 'package:flutter/material.dart';

/// Central visual tokens. Screens should use these instead of raw Color/EdgeInsets.
abstract final class AppTokens {
  // Warm dark palette inspired by the selected premium onboarding reference.
  // Keep semantic success/warning/danger colors separate from the brand accent.
  static const Color bg = Color(0xFF0B090F);
  static const Color surface = Color(0xFF17131A);
  static const Color surfaceElevated = Color(0xFF211B2B);
  static const Color surfaceGlass = Color(0xCC211B2B);
  static const Color line = Color(0xFF3A3040);
  static const Color accent = Color(0xFFD39362);
  static const Color accentDeep = Color(0xFFB96A41);
  static const Color accentSecondary = Color(0xFF827CB6);
  static const Color accentMuted = Color(0x33D39362);
  static const Color textPrimary = Color(0xFFF7F2F3);
  static const Color textSecondary = Color(0xFFC5B6BA);
  static const Color success = Color(0xFF7A9A86);
  static const Color warning = Color(0xFFD4A05A);
  static const Color danger = Color(0xFFC47A72);
  static const Color onAccent = Color(0xFF1A1612);

  static const double space4 = 4;
  static const double space8 = 8;
  static const double space12 = 12;
  static const double space16 = 16;
  static const double space20 = 20;
  static const double space24 = 24;
  static const double space32 = 32;
  static const double space40 = 40;

  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 20;

  static const double buttonHeight = 48;
  static const double inputHeight = 52;
  static const double iconSize = 20;
  static const double iconNav = 20;
  static const double navHeight = 64;
  static const double contentMaxWidth = 640;
}
