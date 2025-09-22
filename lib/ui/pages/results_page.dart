import 'package:flutter/material.dart';
import '../../models/history_entry.dart';
import '../../services/storage.dart';
import 'package:flutter/services.dart';

class ResultsPage extends StatelessWidget {
  const ResultsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final HistoryEntry entry = ModalRoute.of(context)!.settings.arguments as HistoryEntry;

    Widget card(String title, String text, int prob, {IconData icon = Icons.auto_awesome}) {
      return Card(
        margin: const EdgeInsets.symmetric(vertical: 8),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(icon),
                const SizedBox(width: 8),
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                const Spacer(),
                Text('$prob%', style: const TextStyle(fontWeight: FontWeight.bold)),
              ]),
              const SizedBox(height: 8),
              Text(text),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () async {
                    final s = '$title ($prob%)\n\n$text';
                    await Clipboard.setData(ClipboardData(text: s));
                    // ignore: use_build_context_synchronously
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Copiato negli appunti')),
                    );
                  },
                  icon: const Icon(Icons.share),
                  label: const Text('Condividi'),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Risultati')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Domanda: “${entry.question}”', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            Chip(label: Text('Scenario: ${entry.scenario == 'slidingDoors' ? 'Sliding Doors' : 'What the F?!'}')),
            Chip(label: Text('Lato: ${entry.side == 'future' ? 'Futuro' : 'Passato'}')),
          ]),
          const SizedBox(height: 12),
          card('Realistico', entry.answerReal, entry.probReal, icon: Icons.bolt),
          card('What the F?!', entry.answerWtf, entry.probWtf, icon: Icons.psychology),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () => Navigator.of(context).pushReplacementNamed('/home'),
                  icon: const Icon(Icons.fiber_new),
                  label: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('Nuova domanda'),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    await Storage.updateLiked(entry.id, !entry.liked);
                    // ignore: use_build_context_synchronously
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(entry.liked ? 'Rimosso dai preferiti' : 'Messo tra i preferiti')),
                    );
                  },
                  icon: Icon(entry.liked ? Icons.favorite : Icons.favorite_border),
                  label: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('Mi piace'),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
