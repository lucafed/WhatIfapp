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
