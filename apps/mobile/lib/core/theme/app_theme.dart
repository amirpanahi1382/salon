import 'package:flutter/material.dart';

import 'app_tokens.dart';

/// Compatibility aliases used across existing screens.
class AppColors {
  static const background = AppTokens.bg;
  static const surface = AppTokens.surface;
  static const ink = AppTokens.textPrimary;
  static const muted = AppTokens.textSecondary;
  static const line = AppTokens.line;
  static const accent = AppTokens.accent;
  static const accentSoft = AppTokens.accentMuted;
  static const success = AppTokens.success;
  static const warning = AppTokens.warning;
  static const danger = AppTokens.danger;
}

class AppTheme {
  static const fontFamily = 'Vazirmatn';

  static const locale = Locale('fa', 'IR');

  static const supportedLocales = <Locale>[locale];

  /// Product theme (dark charcoal + champagne accent).
  static ThemeData app() => _theme();

  /// Kept for existing tests and call sites; same as [app].
  static ThemeData light() => app();

  static ThemeData _theme() {
    const scheme = ColorScheme.dark(
      brightness: Brightness.dark,
      primary: AppTokens.accent,
      onPrimary: AppTokens.onAccent,
      surface: AppTokens.surface,
      onSurface: AppTokens.textPrimary,
      secondary: AppTokens.surfaceElevated,
      onSecondary: AppTokens.textPrimary,
      error: AppTokens.danger,
      onError: AppTokens.textPrimary,
      outline: AppTokens.line,
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: AppTokens.bg,
    );

    TextStyle vazir({
      required double size,
      FontWeight weight = FontWeight.w400,
      Color color = AppTokens.textPrimary,
      double height = 1.5,
    }) {
      return TextStyle(
        fontFamily: fontFamily,
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height,
      );
    }

    return base.copyWith(
      textTheme: base.textTheme
          .apply(
            fontFamily: fontFamily,
            bodyColor: AppTokens.textPrimary,
            displayColor: AppTokens.textPrimary,
          )
          .copyWith(
            displaySmall: vazir(size: 24, weight: FontWeight.w600, height: 1.45),
            headlineMedium: vazir(size: 36, weight: FontWeight.w500, height: 1.2),
            headlineSmall: vazir(size: 22, weight: FontWeight.w500, height: 1.35),
            titleLarge: vazir(size: 20, weight: FontWeight.w600, height: 1.4),
            titleMedium: vazir(size: 16, weight: FontWeight.w600, height: 1.5),
            titleSmall: vazir(size: 14, weight: FontWeight.w500, height: 1.45),
            bodyMedium: vazir(size: 15, height: 1.65),
            bodySmall: vazir(
              size: 13,
              color: AppTokens.textSecondary,
              height: 1.6,
            ),
            labelLarge: vazir(size: 15, weight: FontWeight.w600, height: 1.3),
            labelMedium: vazir(
              size: 12,
              weight: FontWeight.w500,
              color: AppTokens.textSecondary,
              height: 1.3,
            ),
          ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppTokens.bg,
        foregroundColor: AppTokens.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: vazir(size: 18, weight: FontWeight.w600, height: 1.45),
      ),
      cardTheme: CardThemeData(
        color: AppTokens.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          side: const BorderSide(color: AppTokens.line),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppTokens.surface,
        alignLabelWithHint: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppTokens.space16,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusMd),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          borderSide: const BorderSide(color: AppTokens.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          borderSide: const BorderSide(color: AppTokens.accent),
        ),
        labelStyle: vazir(size: 14, color: AppTokens.textSecondary),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          foregroundColor: AppTokens.onAccent,
          backgroundColor: AppTokens.accent,
          disabledBackgroundColor: AppTokens.surfaceElevated,
          minimumSize: const Size.fromHeight(AppTokens.buttonHeight),
          padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space16,
            vertical: AppTokens.space12,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          ),
          textStyle: vazir(size: 15, weight: FontWeight.w600, height: 1.3),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppTokens.textPrimary,
          minimumSize: const Size(AppTokens.buttonHeight, AppTokens.buttonHeight),
          side: const BorderSide(color: AppTokens.line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          ),
          textStyle: vazir(size: 15, weight: FontWeight.w500, height: 1.3),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppTokens.accent,
          textStyle: vazir(size: 14, weight: FontWeight.w500),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppTokens.surface,
        elevation: 0,
        height: AppTokens.navHeight,
        indicatorColor: Colors.transparent,
        indicatorShape: const RoundedRectangleBorder(),
        overlayColor: WidgetStateProperty.all(Colors.transparent),
        labelPadding: const EdgeInsets.only(top: 2, bottom: 4),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: AppTokens.iconNav,
            color: selected ? AppTokens.accent : AppTokens.textSecondary,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return vazir(
            size: 11,
            weight: selected ? FontWeight.w500 : FontWeight.w400,
            color: selected ? AppTokens.accent : AppTokens.textSecondary,
            height: 1.15,
          );
        }),
      ),
      dividerTheme: const DividerThemeData(
        color: AppTokens.line,
        space: 1,
        thickness: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppTokens.surface,
        selectedColor: AppTokens.accentMuted,
        side: const BorderSide(color: AppTokens.line),
        labelStyle: vazir(size: 13, weight: FontWeight.w500),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusSm),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: AppTokens.surfaceElevated,
        contentTextStyle: TextStyle(
          fontFamily: fontFamily,
          color: AppTokens.textPrimary,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppTokens.surface,
        titleTextStyle: vazir(size: 18, weight: FontWeight.w600, height: 1.5),
        contentTextStyle: vazir(size: 15, height: 1.65),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppTokens.accent,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppTokens.accent,
        foregroundColor: AppTokens.onAccent,
        elevation: 0,
      ),
    );
  }
}
