import 'package:whatifapp/ui/pages/home_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../main.dart' show HomePage;

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _c = PageController();
  int _i = 0;
  @override
  void dispose() { _c.dispose(); super.dispose(); }

  void _goHome() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_)=> const HomePage()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bg = const Color(0xFF0B1116);
    final cyan = const Color(0xFF2BF6E7);
    final amber = const Color(0xFFFFC24B);

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(2, (ix) => Container(
                margin: const EdgeInsets.symmetric(horizontal: 4),
                width: _i==ix ? 18 : 8, height: 8,
                decoration: BoxDecoration(
                  color: _i==ix ? Colors.white : Colors.white24,
                  borderRadius: BorderRadius.circular(8),
                ),
              )),
            ),
            Expanded(
              child: PageView(
                controller: _c,
                onPageChanged: (v)=>setState(()=>_i=v),
                children: [
                  _DoorPage(cyan: cyan),
                  _BarPage(amber: amber),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              child: Column(
                children: [
                  Text(
                    _i==0
                      ? "Ogni giorno scegliamo il nostro destino.\nE se avessimo aperto un’altra porta?"
                      : "E se quella porta portasse dritto al bar?\nWhat a F… scopri l’altra strada.",
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white70, fontSize: 16),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity, height: 56,
                    child: ElevatedButton(
                      onPressed: _goHome,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _i==0 ? cyan : amber,
                        foregroundColor: Colors.black,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: const Text("Entra", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DoorPage extends StatelessWidget {
  const _DoorPage({required this.cyan});
  final Color cyan;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SvgPicture.asset('assets/whatif_door.svg', width: 220),
          const SizedBox(height: 24),
          Text("What?f", style: TextStyle(
            color: cyan, fontSize: 48, fontWeight: FontWeight.w900, letterSpacing: 1.5,
          )),
        ],
      ),
    );
  }
}

class _BarPage extends StatelessWidget {
  const _BarPage({required this.amber});
  final Color amber;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SvgPicture.asset('assets/whataf_bar.svg', width: 240),
          const SizedBox(height: 24),
          Text("What a F...", style: TextStyle(
            color: amber, fontSize: 44, fontWeight: FontWeight.w900, letterSpacing: 1.5,
          )),
        ],
      ),
    );
  }
}
