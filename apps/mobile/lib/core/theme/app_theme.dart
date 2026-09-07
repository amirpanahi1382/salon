import 'package:flutter/material.dart';

class AppColors {
  static const background = Color(0xFFF7F3EF);
  static const surface = Color(0xFFFFFFFF);
  static const ink = Color(0xFF2B2420);
  static const muted = Color(0xFF6F645C);
  static const line = Color(0xFFE6DDD6);
  static const accent = Color(0xFF8A4B4B);
  static const accentSoft = Color(0xFFF3E4E0);
  static const success = Color(0xFF3F6B55);
  static const warning = Color(0xFF9A5B24);
  static const danger = Color(0xFF8A3B3B);
}

class AppTheme {
  static const fontFamily = 'Vazirmatn';

  static const locale = Locale('fa', 'IR');

  static const supportedLocales = <Locale>[locale];

  static ThemeData light() {
    const scheme = ColorScheme.light(
      primary: AppColors.accent,
      onPrimary: Colors.white,
      surface: AppColors.surface,
      onSurface: AppColors.ink,
      secondary: AppColors.accentSoft,
      onSecondary: AppColors.ink,
      error: AppColors.danger,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: AppColors.background,
    );

    return base.copyWith(
      textTheme: base.textTheme.apply(
        fontFamily: fontFamily,
        bodyColor: AppColors.ink,
        displayColor: AppColors.ink,
      ).copyWith(
        bodyMedium: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 15,
          height: 1.65,
          color: AppColors.ink,
        ),
        bodySmall: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 13,
          height: 1.6,
          color: AppColors.muted,
        ),
        titleMedium: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 16,
          height: 1.55,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
        titleLarge: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 20,
          height: 1.5,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
        headlineSmall: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 22,
          height: 1.4,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
        headlineMedium: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 28,
          height: 1.4,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.ink,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 18,
          height: 1.45,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.line),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        alignLabelWithHint: true,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.line),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 15,
            fontWeight: FontWeight.w600,
            height: 1.3,
          ),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        indicatorColor: AppColors.accentSoft,
        height: 84,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          return const TextStyle(
            fontFamily: fontFamily,
            fontSize: 11,
            height: 1.2,
            fontWeight: FontWeight.w600,
          );
        }),
      ),
      dialogTheme: const DialogThemeData(
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 18,
          height: 1.5,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
        contentTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 15,
          height: 1.65,
          color: AppColors.ink,
        ),
      ),
    );
  }
}
