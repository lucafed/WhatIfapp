import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF00D1D1),
      brightness: Brightness.dark,
    );
    return ThemeData(
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFF0B0F10),
      useMaterial3: true,
      textTheme: const TextTheme(
        headlineMedium: TextStyle(fontWeight: FontWeight.w700),
      ),
    );
  }
}
