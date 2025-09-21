#!/usr/bin/env bash
set -euo pipefail

echo "🧹 Creo/aggiorno il model: lib/models/history_entry.dart"
mkdir -p lib/models
cat > lib/models/history_entry.dart << 'DART'
class HistoryEntry {
  final String id;
  final String question;
  final String scenario; // "slidingDoors" | "whatTheF"
  final String side;     // "future" | "past"
  final String createdAt;
  final bool favorite;

  const HistoryEntry({
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

  factory HistoryEntry.fromJson(Map<String, dynamic> json) => HistoryEntry(
        id: json['id'] as String,
        question: json['question'] as String? ?? '',
        scenario: json['scenario'] as String? ?? 'slidingDoors',
        side: json['side'] as String? ?? 'future',
        createdAt: json['createdAt'] as String? ?? '',
        favorite: (json['favorite'] as bool?) ?? false,
      );
}
DART

echo "🛠️  Aggiorno lo store: lib/history/history_store.dart (rimuovo la definizione duplicata di HistoryEntry)"
mkdir -p lib/history
cat > lib/history/history_store.dart << 'DART'
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:whatifapp/models/history_entry.dart';

class HistoryStore extends ChangeNotifier {
  HistoryStore._();
  static final HistoryStore instance = HistoryStore._();

  static const _key = 'history_entries_v1';
  final List<HistoryEntry> _items = [];
  List<HistoryEntry> get items => List.unmodifiable(_items);

  Future<void> load() async {
    try {
      final sp = await SharedPreferences.getInstance();
      final raw = sp.getString(_key);
      _items.clear();
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw) as List<dynamic>;
        _items.addAll(
          decoded.map((e) => HistoryEntry.fromJson(e as Map<String, dynamic>)),
        );
      }
      notifyListeners();
    } catch (e) {
      if (kDebugMode) {
        print('[HistoryStore] load error: $e');
      }
    }
  }

  Future<void> _persist() async {
    try {
      final sp = await SharedPreferences.getInstance();
      final payload = jsonEncode(_items.map((e) => e.toJson()).toList());
      await sp.setString(_key, payload);
    } catch (e) {
      if (kDebugMode) {
        print('[HistoryStore] persist error: $e');
      }
    }
  }

  Future<void> add(HistoryEntry entry) async {
    _items.insert(0, entry);
    notifyListeners();
    await _persist();
  }

  Future<void> toggleFavorite(String id) async {
    final i = _items.indexWhere((e) => e.id == id);
    if (i == -1) return;
    _items[i] = _items[i].copyWith(favorite: !_items[i].favorite);
    notifyListeners();
    await _persist();
  }

  Future<void> removeById(String id) async {
    _items.removeWhere((e) => e.id == id);
    notifyListeners();
    await _persist();
  }

  Future<void> clear() async {
    _items.clear();
    notifyListeners();
    await _persist();
  }
}
DART

echo "🧽 Pulizia import duplicati (se presenti) in lib/main.dart (opzionale e non distruttivo)"
if [ -f lib/main.dart ]; then
  # Non tocchiamo la logica; assicuriamoci solo che gli import siano ordinati
  # e che NON ci sia una definizione duplicata di HistoryEntry nello store.
  # (Ora non c'è più, quindi non serve rimuovere import.)
  :
fi

echo "📦 flutter pub get"
flutter pub get

echo "🏗️  Build web (release) con base-href /WhatIfapp/"
flutter build web --release --base-href "/WhatIfapp/" 2>&1 | tee build-web.log || {
  echo "❌ Build fallita. Controlla le ultime righe di build-web.log:"
  tail -n 120 build-web.log
  exit 1
}

# Se vuoi anche commit + push automatici, decommenta il blocco seguente:
: <<'GITBLOCK'
echo "📝 git add/commit/push"
git add .
git commit -m "fix: unifica HistoryEntry nel model e aggiorna HistoryStore; build web ok"
git push
GITBLOCK

echo "✅ Fatto!"
