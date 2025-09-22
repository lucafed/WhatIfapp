#!/usr/bin/env bash
set -euo pipefail

echo "▶️ What?f – setup full in corso…"

# ---------- Cartelle base ----------
mkdir -p lib/{models,services,ui/{pages,widgets},utils} .github/workflows

# ---------- pubspec (assicura deps minime) ----------
if ! grep -q "shared_preferences" pubspec.yaml; then
  awk '
    BEGIN{done=0}
    /dependencies:/{print; print "  shared_preferences: ^2.2.3"; done=1; next}
    {print}
    END{if(!done) print "dependencies:\n  shared_preferences: ^2.2.3"}' pubspec.yaml > pubspec.tmp
  mv pubspec.tmp pubspec.yaml
fi

# ---------- Modelli ----------
cat > lib/models/history_entry.dart <<'DART'
import 'dart:convert';

class HistoryEntry {
  final String id;
  final String question;
  final String scenario; // 'slidingDoors' | 'whatTheF'
  final String side;     // 'past' | 'future'
  final String createdAt; // ISO 8601
  int likes;
  final double probabilityReal;
  final double probabilityWtf;
  final String answerReal;
  final String answerWtf;

  HistoryEntry({
    required this.id,
    required this.question,
    required this.scenario,
    required this.side,
    required this.createdAt,
    this.likes = 0,
    required this.probabilityReal,
    required this.probabilityWtf,
    required this.answerReal,
    required this.answerWtf,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'question': question,
        'scenario': scenario,
        'side': side,
        'createdAt': createdAt,
        'likes': likes,
        'probabilityReal': probabilityReal,
        'probabilityWtf': probabilityWtf,
        'answerReal': answerReal,
        'answerWtf': answerWtf,
      };

  factory HistoryEntry.fromJson(Map<String, dynamic> map) => HistoryEntry(
        id: map['id'],
        question: map['question'],
        scenario: map['scenario'],
        side: map['side'],
        createdAt: map['createdAt'],
        likes: (map['likes'] ?? 0) as int,
        probabilityReal: (map['probabilityReal'] ?? 0.0).toDouble(),
        probabilityWtf: (map['probabilityWtf'] ?? 0.0).toDouble(),
        answerReal: map['answerReal'] ?? '',
        answerWtf: map['answerWtf'] ?? '',
      );

  static String encodeList(List<HistoryEntry> items) =>
      jsonEncode(items.map((e) => e.toJson()).toList());

  static List<HistoryEntry> decodeList(String? s) {
    if (s == null || s.isEmpty) return [];
    final list = jsonDecode(s) as List<dynamic>;
    return list.map((e) => HistoryEntry.fromJson(e)).toList();
  }
}
DART

# ---------- Servizi ----------
cat > lib/services/history_store.dart <<'DART'
import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

class HistoryStore {
  static const _kKey = 'whatif_history_v1';
  HistoryStore._();
  static final HistoryStore instance = HistoryStore._();

  Future<List<HistoryEntry>> all() async {
    final sp = await SharedPreferences.getInstance();
    return HistoryEntry.decodeList(sp.getString(_kKey));
  }

  Future<void> add(HistoryEntry entry) async {
    final sp = await SharedPreferences.getInstance();
    final list = await all();
    list.insert(0, entry);
    await sp.setString(_kKey, HistoryEntry.encodeList(list));
  }

  Future<void> like(String id) async {
    final sp = await SharedPreferences.getInstance();
    final list = await all();
    for (final e in list) {
      if (e.id == id) { e.likes += 1; break; }
    }
    await sp.setString(_kKey, HistoryEntry.encodeList(list));
  }

  Future<void> clear() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kKey);
  }
}
DART

cat > lib/services/usage_limit_service.dart <<'DART'
import 'package:shared_preferences/shared_preferences.dart';

class UsageLimitService {
  static const _kDayKey = 'whatif_day';
  static const _kCountKey = 'whatif_count';
  static const freeDaily = 3;

  static Future<(int used, int left)> status() async {
    final sp = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0,10);
    final day = sp.getString(_kDayKey);
    int count = sp.getInt(_kCountKey) ?? 0;
    if (day != today) { count = 0; await sp.setString(_kDayKey, today); await sp.setInt(_kCountKey, count); }
    return (count, (freeDaily - count).clamp(0, freeDaily));
    }

  static Future<bool> canAsk() async {
    final s = await status();
    return s.$1 < freeDaily;
  }

  static Future<void> increment() async {
    final sp = await SharedPreferences.getInstance();
    final s = await status();
    await sp.setInt(_kCountKey, s.$1 + 1);
  }
}
DART

# ---------- Tema ----------
cat > lib/theme.dart <<'DART'
import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF00D1D1),
      brightness: Brightness.dark,
    );
    return ThemeData(
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFF0B0F10),
      useMaterial3: true,
      textTheme: const TextTheme(
        headlineMedium: TextStyle(fontWeight: FontWeight.w700),
      ),
    );
  }
}
DART

# ---------- Widget porte / meter / share ----------
cat > lib/ui/widgets/sliding_door.dart <<'DART'
import 'package:flutter/material.dart';

class SlidingDoor extends StatelessWidget {
  final double progress; // 0..1
  const SlidingDoor({super.key, required this.progress});
  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF0D1B1E), Color(0xFF102A43)],
              ),
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: FractionallySizedBox(
            widthFactor: (1 - progress) / 2 + .05,
            child: Container(color: Colors.black.withOpacity(.7)),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: FractionallySizedBox(
            widthFactor: (1 - progress) / 2 + .05,
            child: Container(color: Colors.black.withOpacity(.7)),
          ),
        ),
        Center(
          child: Container(
            width: 6, height: 120,
            decoration: BoxDecoration(
              color: Colors.cyanAccent.withOpacity(.8),
              boxShadow: [BoxShadow(color: Colors.cyanAccent.withOpacity(.5), blurRadius: 20)],
            ),
          ),
        ),
      ],
    );
  }
}
DART

cat > lib/ui/widgets/wtf_portal.dart <<'DART'
import 'dart:math' as math;
import 'package:flutter/material.dart';

class WtfPortal extends StatefulWidget {
  final double progress; // 0..1
  const WtfPortal({super.key, required this.progress});
  @override
  State<WtfPortal> createState() => _WtfPortalState();
}

class _WtfPortalState extends State<WtfPortal> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
  @override
  void dispose() {_c.dispose(); super.dispose();}
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return CustomPaint(
          painter: _PortalPainter(_c.value, widget.progress),
          child: const SizedBox.expand(),
        );
      },
    );
  }
}

class _PortalPainter extends CustomPainter {
  final double t;
  final double p;
  _PortalPainter(this.t, this.p);
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final baseR = math.min(size.width, size.height) * 0.35;
    for (int i=0;i<7;i++){
      final r = baseR * (1 - i*0.12) * (0.6 + p*0.6);
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6 - i.toDouble()
        ..color = HSVColor.fromAHSV(1, (t*360 + i*40)%360, .9, 1).toColor().withOpacity(.9);
      canvas.drawArc(Rect.fromCircle(center: center, radius: r), t*math.pi*2, math.pi*1.5, false, paint);
    }
  }
  @override
  bool shouldRepaint(covariant _PortalPainter old) => old.t != t || old.p != p;
}
DART

cat > lib/ui/widgets/probability_meter.dart <<'DART'
import 'package:flutter/material.dart';

class ProbabilityMeter extends StatelessWidget {
  final double value; // 0..1
  final String label;
  const ProbabilityMeter({super.key, required this.value, required this.label});
  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0,1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: LinearProgressIndicator(minHeight: 12, value: v),
        ),
        const SizedBox(height: 4),
        Text("${(v*100).toStringAsFixed(0)}%"),
      ],
    );
  }
}
DART

cat > lib/ui/widgets/share_buttons.dart <<'DART'
import 'package:flutter/material.dart';
import 'dart:html' as html;

class ShareButtons extends StatelessWidget {
  final String text;
  const ShareButtons({super.key, required this.text});
  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      children: [
        FilledButton.tonal(
          onPressed: () {
            final url = Uri.encodeComponent(html.window.location.href);
            final t = Uri.encodeComponent(text);
            html.window.open('https://twitter.com/intent/tweet?url=$url&text=$t','_blank');
          },
          child: const Text("Condividi X"),
        ),
        FilledButton.tonal(
          onPressed: () { html.window.navigator.clipboard?.writeText(text); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copiato!'))); },
          child: const Text("Copia testo"),
        ),
      ],
    );
  }
}
DART

# ---------- Pagine ----------
cat > lib/ui/pages/history_page.dart <<'DART'
import 'package:flutter/material.dart';
import '../../services/history_store.dart';
import '../../models/history_entry.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});
  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  Future<List<HistoryEntry>> _load() => HistoryStore.instance.all();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Cronologia")),
      body: FutureBuilder(
        future: _load(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final items = snapshot.data!;
          if (items.isEmpty) return const Center(child: Text("Ancora vuota"));
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final e = items[i];
              return ListTile(
                title: Text(e.question),
                subtitle: Text("${e.scenario} • ${e.side} • ${(e.probabilityReal*100).toStringAsFixed(0)}%"),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.favorite, size: 16),
                  const SizedBox(width: 4),
                  Text(e.likes.toString()),
                ]),
                onLongPress: () async { await HistoryStore.instance.like(e.id); setState(() {});},
              );
            },
          );
        },
      ),
    );
  }
}
DART

cat > lib/ui/pages/results_page.dart <<'DART'
import 'package:flutter/material.dart';
import '../../models/history_entry.dart';
import '../widgets/probability_meter.dart';
import '../widgets/share_buttons.dart';
import '../widgets/sliding_door.dart';
import '../widgets/wtf_portal.dart';

class ResultsPage extends StatefulWidget {
  final HistoryEntry entry;
  const ResultsPage({super.key, required this.entry});
  @override
  State<ResultsPage> createState() => _ResultsPageState();
}

class _ResultsPageState extends State<ResultsPage> {
  double _p = 0;
  @override
  void initState(){ super.initState(); Future.delayed(const Duration(milliseconds: 50), () => setState(()=>_p = 1)); }
  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    return Scaffold(
      appBar: AppBar(title: const Text("Risultati")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SizedBox(height: 160, child: Stack(children: [
            if (e.scenario == 'slidingDoors') SlidingDoor(progress: _p) else WtfPortal(progress: _p),
            const Positioned.fill(child: IgnorePointer(child: SizedBox())),
          ])),
          const SizedBox(height: 16),
          Text("Domanda", style: Theme.of(context).textTheme.titleMedium),
          Text(e.question),
          const SizedBox(height: 16),
          Text("Scenario realistico", style: Theme.of(context).textTheme.titleMedium),
          Text(e.answerReal),
          const SizedBox(height: 8),
          ProbabilityMeter(value: e.probabilityReal, label: "Probabilità (realistica)"),
          const SizedBox(height: 16),
          Text("Scenario What the F?!", style: Theme.of(context).textTheme.titleMedium),
          Text(e.answerWtf),
          const SizedBox(height: 8),
          ProbabilityMeter(value: e.probabilityWtf, label: "Probabilità (ironica)"),
          const SizedBox(height: 16),
          ShareButtons(text: "What?f: ${e.question} • Real: ${e.answerReal} • WTF: ${e.answerWtf}"),
        ],
      ),
    );
  }
}
DART

cat > lib/ui/pages/home_page.dart <<'DART'
import 'package:flutter/material.dart';
import '../../models/history_entry.dart';
import '../../services/history_store.dart';
import '../../services/usage_limit_service.dart';
import 'results_page.dart';
import 'history_page.dart';

enum ScenarioType { slidingDoors, whatTheF }

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _ctrl = TextEditingController();
  bool _isFuture = true;
  ScenarioType _scenario = ScenarioType.slidingDoors;

  @override
  void dispose(){ _ctrl.dispose(); super.dispose(); }

  (String real, String wtf, double pr, double pw) _fakeAI(String q, bool isFuture) {
    // Stub semplice ma coerente
    final base = q.isEmpty ? "…(domanda vuota)..." : q;
    final real = isFuture
        ? "Se prosegui, realisticamente: $base porterà a piccoli effetti cumulativi."
        : "Se torni indietro, realisticamente: $base cambierà poco a breve termine.";
    final wtf  = isFuture
        ? "In un universo parallelo: $base scatena un gatto quantistico influencer."
        : "Timeline alternativa: $base causa una pioggia di ravioli al contrario.";
    final pr = 0.35 + (base.length % 40)/100.0;
    final pw = 1 - pr * .6;
    return (real, wtf, pr.clamp(0,1), pw.clamp(0,1));
  }

  Future<void> _open() async {
    final can = await UsageLimitService.canAsk();
    if (!can) {
      if (!mounted) return;
      showDialog(context: context, builder: (_) => AlertDialog(
        title: const Text("Limite giornaliero"),
        content: const Text("Hai raggiunto il limite gratuito di 3 domande. Riprova domani."),
        actions: [TextButton(onPressed: ()=>Navigator.pop(context), child: const Text("OK"))],
      ));
      return;
    }
    final q = _ctrl.text.trim().isEmpty ? "What?f …" : _ctrl.text.trim();
    final (real, wtf, pr, pw) = _fakeAI(q, _isFuture);
    final e = HistoryEntry(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      question: q,
      scenario: _scenario == ScenarioType.slidingDoors ? 'slidingDoors' : 'whatTheF',
      side: _isFuture ? 'future' : 'past',
      createdAt: DateTime.now().toIso8601String(),
      probabilityReal: pr,
      probabilityWtf: pw,
      answerReal: real,
      answerWtf: wtf,
    );
    await HistoryStore.instance.add(e);
    await UsageLimitService.increment();
    if (!mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ResultsPage(entry: e)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("What?f - Home"),
        actions: [
          IconButton(icon: const Icon(Icons.history), onPressed: (){
            Navigator.push(context, MaterialPageRoute(builder: (_) => const HistoryPage()));
          })
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text("Scegli lato del tempo", style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('Passato'), icon: Icon(Icons.history_toggle_off)),
              ButtonSegment(value: true,  label: Text('Futuro'),  icon: Icon(Icons.auto_awesome)),
            ],
            selected: {_isFuture},
            onSelectionChanged: (s)=> setState(()=> _isFuture = s.first),
          ),
          const SizedBox(height: 16),
          Text("Scenario", style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Wrap(spacing: 8, children: [
            ChoiceChip(
              selected: _scenario == ScenarioType.slidingDoors,
              onSelected: (_)=> setState(()=> _scenario = ScenarioType.slidingDoors),
              label: const Text("Sliding Doors"),
            ),
            ChoiceChip(
              selected: _scenario == ScenarioType.whatTheF,
              onSelected: (_)=> setState(()=> _scenario = ScenarioType.whatTheF),
              label: const Text("What the F?!"),
            ),
          ]),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            decoration: const InputDecoration(
              labelText: "Domanda (inizierà con “What?f …”)",
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _open,
            child: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text("Apri la porta"),
            ),
          ),
          const SizedBox(height: 8),
          const Text("Limite: 3 domande/giorno (versione free)"),
        ],
      ),
    );
  }
}
DART

# (stub opzionale: onboarding / settings per future use)
cat > lib/ui/pages/onboarding_page.dart <<'DART'
import 'package:flutter/material.dart';
class OnboardingPage extends StatelessWidget {
  const OnboardingPage({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text("Onboarding (coming soon)")));
}
DART

cat > lib/ui/pages/settings_page.dart <<'DART'
import 'package:flutter/material.dart';
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text("Impostazioni (coming soon)")));
}
DART

# ---------- Main ----------
cat > lib/main.dart <<'DART'
import 'package:flutter/material.dart';
import 'theme.dart';
import 'ui/pages/home_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const WhatIfApp());
}

class WhatIfApp extends StatelessWidget {
  const WhatIfApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'What?f',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      home: const HomePage(),
    );
  }
}
DART

# ---------- GitHub Pages workflow (permessi corretti) ----------
cat > .github/workflows/deploy.yml <<'YAML'
name: Deploy Web to GitHub Pages
on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          channel: stable
      - run: flutter --version
      - run: flutter pub get
      - run: flutter build web --release --base-href "/WhatIfapp/"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: build/web
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
YAML

# ---------- Build, commit, push ----------
flutter clean >/dev/null 2>&1 || true
flutter pub get
flutter build web --release --base-href "/WhatIfapp/"

git add -A
git commit -m "feat(app): struttura completa What?f (pagine, servizi, tema, workflow Pages)" || true
git push

echo "✅ Setup completato. Build in build/web."
echo "ℹ️  Se GitHub Pages è attivo (Settings → Pages → Source: GitHub Actions), il workflow partirà al push."
