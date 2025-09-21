import "package:whatifapp/history/history_page.dart";
import 'package:flutter/material.dart';
import 'models/history_entry.dart';
import 'utils/storage.dart';
import 'history/history_page.dart';
import 'history/history_store.dart';
import 'history/history_page.dart';


void main() => runApp(const WhatifApp());

class AppColors {
  static const primary = Color(0xFF00E0FF);
  static const primaryVariant = Color(0xFF00B5CC);
  static const highlight = Color(0xFF1AFFD5);
}

ThemeData buildLightTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.primary,
    brightness: Brightness.light,
    primary: AppColors.primary,
  );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: Colors.white,
    appBarTheme: const AppBarTheme(centerTitle: true),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
    ),
  );
}

class WhatifApp extends StatefulWidget {
  const WhatifApp({super.key});
  @override
  State<WhatifApp> createState() => _WhatifAppState();
}

class _WhatifAppState extends State<WhatifApp> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Whatifapp',
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      home: Scaffold(
        appBar: AppBar(title: const Text('Whatifapp')),
        body: IndexedStack(
          index: _tab,
          children: const [
            HomePage(),
            HistoryPage(),
            _ExplorePlaceholder(),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.history), label: 'Cronologia'),
            NavigationDestination(icon: Icon(Icons.explore_outlined), label: 'Esplora'),
          ],
        ),
      ),
    );
  }
}

enum ScenarioType { slidingDoors, whatTheF }

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  ScenarioType _scenario = ScenarioType.slidingDoors;
  bool _isFuture = true; // true=Futuro, false=Passato
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _scenarioChip(ScenarioType type, String label, IconData icon) {
    final selected = _scenario == type;
    return ChoiceChip(
      selected: selected,
      label: Row(mainAxisSize: MainAxisSize.min, children: [
            ElevatedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const HistoryPage()),
                );
              },
              child: const Text("Cronologia"),
            ),
        Icon(icon, size: 18),
        const SizedBox(width: 6),
        Text(label),
      ]),
      selectedColor: AppColors.primary.withOpacity(.15),
      onSelected: (_) => setState(() => _scenario = type),
    );
  }

  Future<void> _openDoor() async {
    FocusScope.of(context).unfocus();
    final q = _controller.text.trim();
  final entry = HistoryEntry(
    id: DateTime.now().millisecondsSinceEpoch.toString(),
    question: q,
    scenario: _scenario == ScenarioType.slidingDoors ? 'slidingDoors' : 'whatTheF',
    side: _isFuture ? 'future' : 'past',
    createdAt: DateTime.now().toIso8601String(),
  );

  HistoryStore.instance.add(entry);
    if (q.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Scrivi una domanda prima di aprire la porta.')),
      );
      return;
    }
    final scenarioName =
        _scenario == ScenarioType.slidingDoors ? 'Sliding Doors' : 'What the F.?';
    final timeSide = _isFuture ? 'Futuro' : 'Passato';

    // Salva in cronologia
    final entry = HistoryEntry(
      question: q,
      scenario: scenarioName,
      timeSide: timeSide,
      createdAt: DateTime.now(),
    );
    await Storage.addHistory(entry);

    if (context.mounted) {
      // Placeholder risposta: in step successivo colleghiamo l'IA
      await showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Porta aperta 🚪'),
          content: Text('Scenario: $scenarioName\nLato: $timeSide\nDomanda: $q\n\n(La risposta IA arriva nello step prossimo)'),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
        ),
      );
      // pulizia campo
      _controller.clear();
      // feedback
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Aggiunta alla cronologia')),
      );
    }
  }

  void _reset() {
    setState(() {
      _controller.clear();
      _scenario = ScenarioType.slidingDoors;
      _isFuture = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
            ElevatedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const HistoryPage()),
                );
              },
              child: const Text("Cronologia"),
            ),
          Center(
            child: Text(
              'What?f',
              style: const TextStyle(
                fontSize: 40, fontWeight: FontWeight.w800, letterSpacing: .5,
              ).copyWith(color: AppColors.primary),
            ),
          ),
          const SizedBox(height: 16),
          Text('Scegli una porta:', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
            ElevatedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const HistoryPage()),
                );
              },
              child: const Text("Cronologia"),
            ),
              _scenarioChip(ScenarioType.slidingDoors, 'Sliding Doors', Icons.door_front_door),
              _scenarioChip(ScenarioType.whatTheF, 'What the F.?', Icons.bolt),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
            ElevatedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const HistoryPage()),
                );
              },
              child: const Text("Cronologia"),
            ),
              const Text('Passato'),
              Switch(
                value: _isFuture,
                activeColor: AppColors.primary,
                onChanged: (v) => setState(() => _isFuture = v),
              ),
              const Text('Futuro'),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              prefixText: 'What?f ',
              hintText: 'scrivi la tua domanda…',
            ),
            onSubmitted: (_) => _openDoor(),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _openDoor,
            icon: const Icon(Icons.meeting_room_outlined),
            label: const Text('Apri la Porta'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _reset,
            icon: const Icon(Icons.refresh),
            label: const Text('Nuova domanda'),
          ),
        ],
      ),
    );
  }
}

class _ExplorePlaceholder extends StatelessWidget {
  const _ExplorePlaceholder();
  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('Esplora (in arrivo)'));
  }
}
