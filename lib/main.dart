import 'package:flutter/material.dart';
import 'ui/pages/onboarding_screen.dart';
import 'ui/pages/home_page.dart';
import 'ui/pages/detail_page.dart';

void main() {
  runApp(const WhatIfApp());
}

class WhatIfApp extends StatelessWidget {
  const WhatIfApp({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = ThemeData(
      brightness: Brightness.dark,
      useMaterial3: true,
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFF00D1FF),
        secondary: Color(0xFF00D1FF),
      ),
    );

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'What?f',
      theme: dark,
      routes: {
        '/': (_) => const OnboardingScreen(),
        '/home': (_) => const HomePage(),
        '/detail': (_) => const DetailPage(),
      },
    );
  }
}
