#!/bin/bash
set -euo pipefail

echo "▶️ 0) Creo cartella assets e SVG (se mancano)…"
mkdir -p assets
[ -f assets/whatif_door.svg ] || cat > assets/whatif_door.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#0B1B1E"/>
  <text x="20" y="80" font-size="48" fill="#2BF6E7" font-weight="bold">What?f</text>
  <rect x="120" y="120" width="160" height="220" fill="#0E2C30" stroke="#2BF6E7" stroke-width="4"/>
  <rect x="140" y="140" width="120" height="180" fill="#2BF6E7" opacity="0.3"/>
  <circle cx="150" cy="230" r="6" fill="#2BF6E7"/>
</svg>
SVG
[ -f assets/whataf_bar.svg ] || cat > assets/whataf_bar.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#0A0F14"/>
  <text x="20" y="100" font-size="42" fill="#22E1E7" font-weight="bold">What a</text>
  <text x="20" y="180" font-size="72" fill="#22E1E7" font-weight="bold">F…</text>
  <circle cx="280" cy="160" r="60" fill="#FFD54D" stroke="#FFB300" stroke-width="6"/>
  <circle cx="260" cy="150" r="6" fill="#1B1B1B"/>
  <circle cx="300" cy="155" r="6" fill="#1B1B1B"/>
  <path d="M250 190 q30 20 60 0" stroke="#1B1B1B" stroke-width="5" fill="none"/>
  <rect x="310" y="130" width="30" height="50" fill="#FFD54D" stroke="#FFB300" stroke-width="4"/>
</svg>
SVG
echo "✅ SVG ok"

echo "▶️ 1) Assicuro flutter_svg in pubspec.yaml…"
if ! grep -qE '^[[:space:]]*flutter_svg:' pubspec.yaml; then
  awk 'BEGIN{a=0} /^dependencies:[[:space:]]*$/ && !a {print;print "  flutter_svg: ^2.0.9"; a=1; next} {print}' pubspec.yaml > pubspec.yaml.tmp && mv pubspec.yaml.tmp pubspec.yaml
  echo "✅ aggiunto flutter_svg"
else
  echo "ℹ️ flutter_svg già presente"
fi

echo "▶️ 2) Registro gli assets in pubspec.yaml…"
if ! grep -qE '^[[:space:]]*assets:[[:space:]]*$' pubspec.yaml; then
  sed -i '/^[[:space:]]*uses-material-design:[[:space:]]*true[[:space:]]*$/a\
  assets:\n    - assets/whatif_door.svg\n    - assets/whataf_bar.svg' pubspec.yaml || true
fi
# sezione già presente → garantisco le due righe
grep -q 'assets/whatif_door.svg' pubspec.yaml || sed -i '/^[[:space:]]*assets:[[:space:]]*$/a\    - assets/whatif_door.svg' pubspec.yaml
grep -q 'assets/whataf_bar.svg'  pubspec.yaml || sed -i '/^[[:space:]]*assets:[[:space:]]*$/a\    - assets/whataf_bar.svg'  pubspec.yaml
echo "✅ assets registrati"

echo "▶️ 3) Scrivo onboarding pulito…"
mkdir -p lib/ui/pages
cat > lib/ui/pages/onboarding_screen.dart <<'DART'
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
      MaterialPageRoute(builder: (_) => const HomePage()),
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
DART
echo "✅ onboarding_screen.dart scritto"

echo "▶️ 4) Imposto Onboarding come home in lib/main.dart…"
cp lib/main.dart lib/main.dart.bak.$(date +%s) || true
if ! grep -q "OnboardingScreen" lib/main.dart; then
  # importa e sostituisce home
  awk '
    BEGIN{imp=0}
    /^import / && !imp {print; next}
    {print}
  ' lib/main.dart > lib/main.dart.tmp

  # Inserisci l'import se manca
  grep -q "onboarding_screen.dart" lib/main.dart.tmp || \
    sed -i "1i import 'ui/pages/onboarding_screen.dart';" lib/main.dart.tmp

  # Rimpiazza home: const HomePage() -> const OnboardingScreen()
  sed -i "s/const HomePage()/const OnboardingScreen()/g" lib/main.dart.tmp

  mv lib/main.dart.tmp lib/main.dart
fi
echo "✅ main.dart aggiornato"

echo "▶️ 5) flutter pub get…"
flutter pub get
echo "🎉 Done. Avvia:  flutter run -d chrome"
