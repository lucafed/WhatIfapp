import 'package:flutter/material.dart';
import '../../services/ai_service.dart';
import '../../services/storage.dart';
import '../../services/usage_limit_service.dart';
import '../../models/history_entry.dart';

enum ScenarioType { slidingDoors, whatTheF }

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  ScenarioType scenario = ScenarioType.slidingDoors;
  bool isFuture = true;
  final txt = TextEditingController();
  bool loading = false;

  Future<void> _ask() async {
    final q = txt.text.trim();
    if (q.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Scrivi la domanda prima di aprire la porta.')),
      );
      return;
    }

    if (!await UsageLimitService.canAsk()) {
      final left = await UsageLimitService.remaining();
      // left sarà 0 qui
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Limite giornaliero'),
          content: Text('Hai raggiunto le 3 domande gratuite di oggi.\nRiprova domani. (rimaste: $left)'),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
        ),
      );
      return;
    }

    setState(() => loading = true);
    try {
      final res = await AiService.generate(
        question: q,
        side: isFuture ? 'future' : 'past',
      );

      final entry = HistoryEntry(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        question: q,
        side: isFuture ? 'future' : 'past',
        scenario: scenario == ScenarioType.slidingDoors ? 'slidingDoors' : 'whatTheF',
        createdAt: DateTime.now().toIso8601String(),
        answerReal: res['answerReal'] as String,
        probReal: res['probReal'] as int,
        answerWtf: res['answerWtf'] as String,
        probWtf: res['probWtf'] as int,
      );

      await Storage.addHistory(entry);
      await UsageLimitService.increment();

      if (!mounted) return;
      Navigator.of(context).pushNamed('/results', arguments: entry);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final chipStyle = (bool selected) => ElevatedButton.styleFrom(
          backgroundColor: selected ? Colors.teal : Colors.grey.shade800,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        );

    return Scaffold(
      appBar: AppBar(
        title: const Text('What?f - Home'),
        actions: [
          IconButton(
            onPressed: () => Navigator.of(context).pushNamed('/history'),
            icon: const Icon(Icons.history),
            tooltip: 'Cronologia',
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('Passato', style: TextStyle(color: Colors.white70)),
                Switch(
                  value: isFuture,
                  onChanged: (v) => setState(() => isFuture = v),
                ),
                Text('Futuro', style: TextStyle(color: Colors.white70)),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.center,
              children: [
                ElevatedButton(
                  style: chipStyle(scenario == ScenarioType.slidingDoors),
                  onPressed: () => setState(() => scenario = ScenarioType.slidingDoors),
                  child: const Text('Sliding Doors'),
                ),
                ElevatedButton(
                  style: chipStyle(scenario == ScenarioType.whatTheF),
                  onPressed: () => setState(() => scenario = ScenarioType.whatTheF),
                  child: const Text('What the F?!'),
                ),
              ],
            ),
            const SizedBox(height: 20),
            TextField(
              controller: txt,
              minLines: 1,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'What?f … (scrivi la tua domanda)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            FutureBuilder<int>(
              future: UsageLimitService.remaining(),
              builder: (_, snap) {
                final left = snap.data ?? 3;
                return Text('Domande rimaste oggi: $left / 3',
                    textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70));
              },
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: loading ? null : _ask,
                icon: const Icon(Icons.door_sliding),
                label: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(loading ? 'Apro…' : 'Apri la porta', style: const TextStyle(fontSize: 18)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
