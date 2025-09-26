import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _ctrl = PageController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Widget _dots(int idx) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      margin: const EdgeInsets.symmetric(horizontal: 4),
      width: _ctrl.hasClients && _ctrl.page?.round() == idx ? 22 : 8,
      height: 8,
      decoration: BoxDecoration(
        color: _ctrl.hasClients && _ctrl.page?.round() == idx
            ? const Color(0xFF00E0FF)
            : const Color(0xFF2B3A44),
        borderRadius: BorderRadius.circular(8),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bg = const Color(0xFF0A0F14);
    final textPrimary = Colors.white;
    final accent = const Color(0xFF00E0FF);

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _ctrl,
                onPageChanged: (_) => setState(() {}),
                children: [
                  // Pagina 1 — Benvenuto + logo porta
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        const SizedBox(height: 16),
                        Text(
                          'Benvenuto su What?f',
                          style: TextStyle(
                            color: accent,
                            fontSize: 26,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 18),
                        Expanded(
                          child: Center(
                            child: SvgPicture.asset(
                              'assets/whatif_door.svg',
                              width: 380,
                              semanticsLabel: 'What?f – door logo',
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'Le scelte ci definiscono',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: textPrimary,
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'What?f ti mostra “come sarebbe andata”\n'
                          'o “come potrebbe andare”.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 22),
                      ],
                    ),
                  ),
                  // Pagina 2 — logo bar + bottone Start (nessuna frase extra)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Column(
                      children: [
                        const SizedBox(height: 16),
                        Expanded(
                          child: Center(
                            child: SvgPicture.asset(
                              'assets/whatif_bar.svg',
                              width: 420,
                              semanticsLabel: 'What the F?! – bar logo',
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: accent,
                              foregroundColor: Colors.black,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                            ),
                            onPressed: () {
                              // TODO: qui si va alla Home/flow domande
                              Navigator.of(context).pushReplacement(
                                MaterialPageRoute(builder: (_) => const _StubHome()),
                              );
                            },
                            child: const Text(
                              'Start',
                              style: TextStyle(
                                fontSize: 18, fontWeight: FontWeight.w700),
                            ),
                          ),
                        ),
                        const SizedBox(height: 22),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            // Dots indicator (nessuna frase sotto)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(2, (i) => _dots(i)),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}

class _StubHome extends StatelessWidget {
  const _StubHome();
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0F14),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0A0F14),
        title: const Text('What?f – Home'),
      ),
      body: const Center(
        child: Text(
          'Stub Home – prossimo passo inseriamo tutto il flow',
          style: TextStyle(color: Colors.white70),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
