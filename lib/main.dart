import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

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
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF38BDF8),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      initialRoute: '/',
      routes: {
        '/': (_) => const OnboardingPage(),
        '/home': (_) => const HomePage(),
        '/detail': (_) => const DetailPage(),
      },
    );
  }
}

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final _controller = PageController();
  int _page = 0;

  void _goHome() {
    Navigator.pushReplacementNamed(context, '/home');
  }

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
                  _OnboardSlide(
                    title: 'What?f',
                    subtitle: 'Ogni giorno scegliamo il nostro destino...\nSe avessimo aperto un’altra porta?',
                    asset: 'assets/svg/whatif_door.svg',
                  ),
                  _OnboardSlide(
                    title: 'Le scelte ci definiscono',
                    subtitle: 'What?f ti mostra “come sarebbe andata”.',
                    asset: 'assets/svg/whatif_choice.svg',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(2, (i) {
                final active = i == _page;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  width: active ? 18 : 8,
                  height: 8,
                  margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
                  decoration: BoxDecoration(
                    color: active ? Theme.of(context).colorScheme.primary : Colors.white24,
                    borderRadius: BorderRadius.circular(8),
                  ),
                );
              }),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _goHome,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 14.0),
                    child: Text('Inizia', style: TextStyle(fontSize: 18)),
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

class _OnboardSlide extends StatelessWidget {
  final String title;
  final String subtitle;
  final String asset;

  const _OnboardSlide({
    required this.title,
    required this.subtitle,
    required this.asset,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Expanded(
            child: Center(
              child: SvgPicture.asset(
                asset,
                width: 320,
                height: 220,
                fit: BoxFit.contain,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 16, color: Colors.white70),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        title: Row(
          children: [
            SvgPicture.asset('assets/svg/whatif_logo.svg', height: 28),
            const SizedBox(width: 10),
            const Text('Home', style: TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Benvenuto in What?f!', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.pushNamed(context, '/detail'),
              child: const Text('Vai ai dettagli'),
            ),
          ],
        ),
      ),
    );
  }
}

class DetailPage extends StatelessWidget {
  const DetailPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Dettagli')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24.0),
          child: Text(
            'Qui potremo mostrare i “rami” delle scelte, le timeline alternative, ecc.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
