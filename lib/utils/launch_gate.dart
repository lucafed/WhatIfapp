import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:whatifapp/ui/pages/onboarding_screen.dart';
import 'package:whatifapp/main.dart' show HomePage;

class LaunchGate extends StatelessWidget {
  const LaunchGate({super.key});

  Future<bool> _seen() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool('onboarding_seen') ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _seen(),
      builder: (context, snap) {
        if (!snap.hasData) {
          return const Material(
            color: Colors.black,
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final alreadySeen = snap.data ?? false;
        return alreadySeen ? const HomePage() : const OnboardingScreen();
      },
    );
  }
}
