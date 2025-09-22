import 'package:flutter/material.dart';

class OnboardingPage extends StatelessWidget {
  const OnboardingPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              const Text(
                'What?f',
                style: TextStyle(fontSize: 48, fontWeight: FontWeight.w800, color: Colors.white),
              ),
              const SizedBox(height: 12),
              const Text(
                'Scegli la porta:\n• Sliding Doors (realistico)\n• What the F?! (ironico)',
                style: TextStyle(color: Colors.white70, fontSize: 16, height: 1.4),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => Navigator.of(context).pushReplacementNamed('/home'),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 14),
                    child: Text('Entra', style: TextStyle(fontSize: 18)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
