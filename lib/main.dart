import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'history/history_page.dart';
import 'history/history_store.dart';
import 'models/history_entry.dart';
import 'utils/storage.dart';

void main() {
  runApp(const WhatIfApp());
}

class WhatIfApp extends StatelessWidget {
  const WhatIfApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WhatIf',
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      home: const HomePage(),
    );
  }
}

ThemeData buildLightTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: Colors.teal);
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    textTheme: GoogleFonts.interTextTheme(),
  );
}

enum ScenarioType { slidingDoors, whatTheF }

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _controller = TextEditingController();
  ScenarioType _scenario = ScenarioType.slidingDoors;
  bool _isFuture = true;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openDoor() async {
    FocusScope.of(context).unfocus();
    final q = _controller.text.trim();
    if (q.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Scrivi una domanda prima di aprire la porta.')),
      );
      return;
    }

    final newEntry = HistoryEntry(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      question: q,
      scenario: _scenario == ScenarioType.slidingDoors ? 'slidingDoors' : 'whatTheF',
      side: _isFuture ? 'future' : 'past',
      createdAt: DateTime.now().toIso8601String(),
    );

    // Aggiorno subito lo store (UI) e persisto su SharedPreferences
    HistoryStore.instance.add(newEntry);
    await Storage.addHistory(newEntry);

    // Feedback rapido
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Aggiunta alla cronologia')),
    );

    // Dialog “porta aperta” semplice
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Porta aperta'),
        content: Text(
          _isFuture
              ? 'Hai sbirciato nel futuro dello scenario "${_scenario == ScenarioType.slidingDoors ? 'Sliding Doors' : 'What The F?'}".'
              : 'Hai sbirciato nel passato dello scenario "${_scenario == ScenarioType.slidingDoors ? 'Sliding Doors' : 'What The F?'}".',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Chiudi'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Scaffold(
        appBar: AppBar(
          title: const Text('WhatIf'),
          actions: [
            IconButton(
              tooltip: 'Cronologia',
              icon: const Icon(Icons.history),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const HistoryPage()),
                );
              },
            ),
          ],
        ),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: ListView(
            children: [
              TextField(
                controller: _controller,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'La tua domanda',
                  hintText: 'Es. E se avessi accettato quel lavoro?',
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _openDoor(),
              ),
              const SizedBox(height: 16),

              // Scelta scenario
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _ScenarioChoice(
                    label: 'Sliding Doors',
                    selected: _scenario == ScenarioType.slidingDoors,
                    onTap: () => setState(() => _scenario = ScenarioType.slidingDoors),
                  ),
                  _ScenarioChoice(
                    label: 'What The F?',
                    selected: _scenario == ScenarioType.whatTheF,
                    onTap: () => setState(() => _scenario = ScenarioType.whatTheF),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Scelta passato/futuro
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: const Text('Passato'),
                    selected: !_isFuture,
                    onSelected: (_) => setState(() => _isFuture = false),
                  ),
                  ChoiceChip(
                    label: const Text('Futuro'),
                    selected: _isFuture,
                    onSelected: (_) => setState(() => _isFuture = true),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              FilledButton.icon(
                onPressed: _openDoor,
                icon: const Icon(Icons.meeting_room_outlined),
                label: const Text('Apri la porta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ScenarioChoice extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ScenarioChoice({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
    );
  }
}
