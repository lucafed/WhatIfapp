import 'package:flutter/material.dart';
import '../../models/result_entry.dart';
import '../../services/ai.dart';
import '../../services/share.dart';
import '../../services/tts.dart';
import '../../theme.dart';

class ResultsPage extends StatefulWidget {
  final String question;
  final bool isFuture;
  const ResultsPage({super.key, required this.question, required this.isFuture});

  @override
  State<ResultsPage> createState() => _ResultsPageState();
}

class _ResultsPageState extends State<ResultsPage> {
  final AiClient _ai = const LocalMockAiClient();
  late Future<List<ResultEntry>> _future;

  @override
  void initState() {
    super.initState();
    _future = _ai.generate(question: widget.question, isFuture: widget.isFuture);
  }

  @override
  void dispose() {
    TtsService.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Risultati')),
      backgroundColor: scheme.background,
      body: FutureBuilder<List<ResultEntry>>(
        future: _future,
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final results = snap.data!;
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: results.length,
            separatorBuilder: (_, __)=>const SizedBox(height: 12),
            itemBuilder: (_, i) => _ResultCard(
              entry: results[i],
              onShare: () => ShareService.shareText(results[i].text),
              onTts: () => TtsService.speak(results[i].text),
              onToggle: () => setState(()=> results[i].expanded = !results[i].expanded),
            ),
          );
        },
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  final ResultEntry entry;
  final VoidCallback onShare, onTts, onToggle;
  const _ResultCard({required this.entry, required this.onShare, required this.onTts, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final title = entry.scenario == 'slidingDoors' ? 'Sliding Doors' : 'What the F?!';
    final color = entry.scenario == 'slidingDoors' ? AppTheme.turquoise : AppTheme.neonPink;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(.3)),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Text(title, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: color)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                color: color.withOpacity(.15),
                border: Border.all(color: color.withOpacity(.4)),
              ),
              child: Text('${entry.probability}%', style: TextStyle(fontWeight: FontWeight.w700, color: color)),
            ),
          ]),
          const SizedBox(height: 10),
          Text(
            entry.expanded ? entry.text : _truncate(entry.text),
            style: const TextStyle(height: 1.25),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              TextButton(onPressed: onToggle, child: Text(entry.expanded ? 'Vedi meno' : 'Vedi di più')),
              const Spacer(),
              IconButton(onPressed: onShare, icon: const Icon(Icons.ios_share)),
              IconButton(onPressed: onTts,   icon: const Icon(Icons.volume_up)),
            ],
          ),
        ],
      ),
    );
  }

  static String _truncate(String s, {int max=180}) =>
      s.length <= max ? s : s.substring(0, max).trimRight() + '…';
}
