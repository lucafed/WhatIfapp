import 'package:flutter/material.dart';
import 'ui/pages/onboarding_screen.dart';

void main() {
  runApp(const WhatIfApp());
}

class WhatIfApp extends StatelessWidget {
  const WhatIfApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'What?f',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        scaffoldBackgroundColor: const Color(0xFF0A0F14),
        primaryColor: const Color(0xFF00E0FF),
        textTheme: const TextTheme(
          bodyLarge: TextStyle(color: Colors.white, fontSize: 18),
          bodyMedium: TextStyle(color: Color(0xFFA0B2BA), fontSize: 16),
        ),
      ),
      home: const OnboardingScreen(),
    );
  }
}
