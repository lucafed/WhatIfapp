import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:whatifapp/ui/pages/home_page.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _goHome() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const HomePage()),
    );
  }

  Widget _page({required String asset, required String title, required String subtitle, required String btnText}) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16),
        child: Column(
          children: [
            const SizedBox(height: 12),
            Expanded(
              child: Center(
                child: SvgPicture.asset(
                  asset,
                  width: 320,
                  height: 320,
                  semanticsLabel: title,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 8),
            Text(subtitle, style: const TextStyle(fontSize: 14, color: Colors.white70), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomePage())),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                backgroundColor: const Color(0xFF22E1E7),
                foregroundColor: Colors.black,
              ),
              child: Text(btnText, style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      _page(
        asset: 'assets/whatif_door.svg',
        title: 'What?f',
        subtitle: 'Se avessimo aperto un\'altra porta? Scopri le possibilità.',
        btnText: 'Inizia',
      ),
      _page(
        asset: 'assets/whataf_bar.svg',
        title: 'What a F…',
        subtitle: 'E se tutto fosse successo in un bar? Un tocco di follia e ironia.',
        btnText: 'Inizia',
      ),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF071015),
      body: Column(
        children: [
          Expanded(
            child: PageView.builder(
              controller: _controller,
              itemCount: pages.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (_, i) => pages[i],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 18.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(pages.length, (i) {
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  margin: const EdgeInsets.symmetric(horizontal: 6),
                  width: _index == i ? 24 : 10,
                  height: 8,
                  decoration: BoxDecoration(
                    color: _index == i ? const Color(0xFF22E1E7) : Colors.white24,
                    borderRadius: BorderRadius.circular(8),
                  ),
                );
              }),
            ),
          )
        ],
      ),
    );
  }
}
