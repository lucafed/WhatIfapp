import 'package:flutter/material.dart';
import 'theme.dart';
import 'ui/pages/_exports.dart';

void main() {
  runApp(const WhatIfApp());
}

class WhatIfApp extends StatelessWidget {
  const WhatIfApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'What?f',
      theme: AppTheme.dark(),
      debugShowCheckedModeBanner: false,
      initialRoute: '/onboarding',
      routes: {
        '/onboarding': (_) => const OnboardingPage(),
        '/home': (_) => const HomePage(),
        '/results': (_) => const ResultsPage(),
        '/history': (_) => const HistoryPage(),
      },
    );
  }
}
