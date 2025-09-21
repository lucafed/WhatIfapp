#!/usr/bin/env bash
set -euo pipefail

echo "📁 Creo cartella history…"
mkdir -p lib/history

echo "📝 Scrivo lib/history/history_store.dart…"
cat > lib/history/history_store.dart <<'DART'
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class HistoryEntry {
  final String id;
  final String question;
  final String scenario; // "slidingDoors" | "whatTheF"
  final String side;     // "future" | "past"
  final String createdAt;
  final bool favorite;

  HistoryEntry({
    required this.id,
    required this.question,
    required this.scenario,
    required this.side,
    required this.createdAt,
    this.favorite = false,
  });

  HistoryEntry copyWith({bool? favorite}) => HistoryEntry(
        id: id,
        question: question,
        scenario: scenario,
        side: side,
        createdAt: createdAt,
        favorite: favorite ?? this.favorite,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'question': question,
        'scenario': scenario,
        'side': side,
        'createdAt': createdAt,
        'favorite': favorite,
      };

  static HistoryEntry fromJson(Map<String, dynamic> j) => HistoryEntry(
        id: j['id'],
        question: j['question'],
        scenario: j['scenario'],
        side: j['side'],
        createdAt: j['createdAt'],
        favorite: j['favorite'] ?? false,
      );
}

class HistoryStore extends ChangeNotifier {
  static final instance = HistoryStore._();
  HistoryStore._();

  final List<HistoryEntry> _items = [];
  List<HistoryEntry> get items => List.unmodifiable(_items);

  static const _key = 'history_v1';

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    _items
      ..clear()
      ..addAll(raw == null
          ? const <HistoryEntry>[]
          : (jsonDecode(raw) as List)
              .map((e) => HistoryEntry.fromJson(e as Map<String, dynamic>)));
    notifyListeners();
  }

  Future<void> add(HistoryEntry e) async {
    _items.insert(0, e);
    await _save();
    notifyListeners();
  }

  Future<void> toggleFavorite(String id) async {
    final i = _items.indexWhere((x) => x.id == id);
    if (i != -1) {
      _items[i] = _items[i].copyWith(favorite: !_items[i].favorite);
      await _save();
      notifyListeners();
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _key,
      jsonEncode(_items.map((e) => e.toJson()).toList()),
    );
  }
}
DART

echo "�� Scrivo lib/history/history_page.dart…"
cat > lib/history/history_page.dart <<'DART'
import 'package:flutter/material.dart';
import 'package:whatifapp/history/history_store.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  @override
  void initState() {
    super.initState();
    HistoryStore.instance.load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cronologia')),
      body: AnimatedBuilder(
        animation: HistoryStore.instance,
        builder: (_, __) {
          final items = HistoryStore.instance.items;
          if (items.isEmpty) {
            return const Center(child: Text('Nessuna domanda ancora.'));
          }
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final e = items[i];
              return ListTile(
                title: Text(e.question),
                subtitle: Text('${e.scenario} • ${e.side}'),
                trailing: IconButton(
                  icon: Icon(e.favorite ? Icons.favorite : Icons.favorite_border),
                  onPressed: () => HistoryStore.instance.toggleFavorite(e.id),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
DART

echo "🧩 Verifico dipendenza shared_preferences in pubspec.yaml…"
if ! grep -qE '^\s*shared_preferences:' pubspec.yaml; then
  # inserisce sotto "dependencies:" (indenta con due spazi)
  sed -i '/^dependencies:/a\  shared_preferences: ^2.2.3' pubspec.yaml
  echo "  ➕ Aggiunta shared_preferences: ^2.2.3"
else
  echo "  ✔️ shared_preferences già presente"
fi

echo "🧷 Import in lib/main.dart (se mancano)…"
# aggiungi import HistoryStore
if ! grep -q "history/history_store.dart" lib/main.dart; then
  sed -i "1i import 'history/history_store.dart';" lib/main.dart
fi
# aggiungi import HistoryPage
if ! grep -q "history/history_page.dart" lib/main.dart; then
  sed -i "1i import 'history/history_page.dart';" lib/main.dart
fi

echo "✍️  Inietto salvataggio in _openDoor()…"
# inserisce il blocco subito dopo la riga con 'final q = _controller.text.trim();'
if grep -q "final q = _controller.text.trim();" lib/main.dart; then
  awk '
    BEGIN{done=0}
    {
      print $0
      if (!done && $0 ~ /final q = _controller\.text\.trim\(\);/) {
        print "  final entry = HistoryEntry("
        print "    id: DateTime.now().millisecondsSinceEpoch.toString(),"
        print "    question: q,"
        print "    scenario: _scenario == ScenarioType.slidingDoors ? '\''slidingDoors'\'' : '\''whatTheF'\'',"
        print "    side: _isFuture ? '\''future'\'' : '\''past'\'',"
        print "    createdAt: DateTime.now().toIso8601String(),"
        print "  );"
        print ""
        print "  HistoryStore.instance.add(entry);"
        done=1
      }
    }
  ' lib/main.dart > lib/main.dart.__tmp && mv lib/main.dart.__tmp lib/main.dart
else
  echo "  ⚠️ Non ho trovato la riga 'final q = _controller.text.trim();' in lib/main.dart."
  echo "     Se il nome della variabile è diverso, poi me lo dici e lo adatto."
fi

echo "📦 flutter pub get…"
flutter pub get

echo "🛠️ Build web (release)…"
flutter build web --release --base-href "/WhatIfapp/"

echo "✅ Fatto. Avvio anche il web-server (porta 8080)."
echo "   Se sei in Codespaces apri la porta 8080 da PORTS -> Open in Browser."
flutter run -d web-server --web-port 8080
