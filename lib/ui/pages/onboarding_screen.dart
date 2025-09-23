import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _controller,
                onPageChanged: (i) => setState(() => _page = i),
                children: const [
                  _OnbPage(
                    title: 'What?f',
                    subtitle:
                        'Ogni giorno scegliamo il nostro destino...\nSe avessimo aperto un’altra porta?',
                    svgPath: 'assets/whatif_door.svg',
                  ),
                  _OnbPage(
                    title: 'Le scelte ci definiscono',
                    subtitle:
                        'What?f ti mostra come sarebbe andata se fossi entrato in un bar diverso.',
                    svgPath: 'assets/whatif_bar.svg',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                2,
                (i) => Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _page == i ? Colors.white : Colors.white24,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () =>
                      Navigator.pushReplacementNamed(context, '/home'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    backgroundColor: const Color(0xFF00D1FF),
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text(
                    'Inizia',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnbPage extends StatelessWidget {
  final String title;
  final String subtitle;
  final String svgPath;

  const _OnbPage({
    required this.title,
    required this.subtitle,
    required this.svgPath,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 0),
      child: Column(
        children: [
          const Spacer(),
          SvgPicture.asset(
            svgPath,
            height: 220,
            fit: BoxFit.contain,
            placeholderBuilder: (_) => const SizedBox(
              height: 220,
              child: Center(child: CircularProgressIndicator()),
            ),
          ),
          const SizedBox(height: 32),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 34,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 18,
              color: Colors.white70,
              height: 1.4,
            ),
          ),
          const Spacer(),
        ],
      ),
    );
  }
}
