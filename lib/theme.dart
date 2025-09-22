import 'package:flutter/material.dart';

class AppTheme {
  // Palette: turchese + scuro + psichedelico
  static const Color turquoise = Color(0xFF14E5D5);
  static const Color midnight  = Color(0xFF0B1020);
  static const Color neonPink  = Color(0xFFFF3FD1);
  static const Color acidLime  = Color(0xFFB7FF30);
  static const Color deepBlue  = Color(0xFF131A33);

  static ThemeData dark() {
    final base = ThemeData.dark(useMaterial3: true);
    final scheme = ColorScheme.fromSeed(
      seedColor: turquoise,
      brightness: Brightness.dark,
      primary: turquoise,
      secondary: neonPink,
      background: midnight,
      surface: deepBlue,
    );
    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.background,
      textTheme: base.textTheme.apply(
        bodyColor: Colors.white,
        displayColor: Colors.white,
      ),
      chipTheme: base.chipTheme.copyWith(
        selectedColor: turquoise.withOpacity(.2),
        labelStyle: const TextStyle(color: Colors.white),
        side: BorderSide(color: turquoise.withOpacity(.4)),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: turquoise,
          foregroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
