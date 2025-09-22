import 'package:flutter/material.dart';
import '../../theme.dart';

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final _page = PageController();
  int _idx = 0;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: scheme.background,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _page,
                onPageChanged: (i)=>setState(()=>_idx=i),
                children: const [
                  _IntroSlide(title: "Benvenuto in What?f", text: "Fai una domanda… e apri la porta."),
                  _IntroSlide(title: "Sliding Doors", text: "Scenario realistico con una chance stimata."),
                  _IntroSlide(title: "What the F?!", text: "Scenario ironico/psichedelico per sognare."),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(3, (i)=>Container(
                margin: const EdgeInsets.all(4),
                width: 10, height: 10,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: i==_idx ? AppTheme.turquoise : Colors.white24,
                ),
              )),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: ()=>Navigator.of(context).maybePop(),
                  child: const Text("Comincia"),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _IntroSlide extends StatelessWidget {
  final String title, text;
  const _IntroSlide({required this.title, required this.text});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppTheme.turquoise.withOpacity(.25)),
        ),
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(title, textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            Text(text, textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, height: 1.3)),
          ],
        ),
      ),
    );
  }
}
