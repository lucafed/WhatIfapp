#!/usr/bin/env bash
set -euo pipefail

echo "== 1) Modello HistoryEntry =="
cat > lib/models/history_entry.dart <<'DART'
import 'dart:convert';

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

  factory HistoryEntry.fromJson(Map<String, dynamic> j) => HistoryEntry(
        id: j['id'] as String,
        question: j['question'] as String,
        scenario: j['scenario'] as String,
        // supporta vecchio campo "timeSide"
        side: (j['side'] ?? j['timeSide'] ?? 'future') as String,
        createdAt: j['createdAt'] as String,
        favorite: (j['favorite'] ?? false) as bool,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'question': question,
        'scenario': scenario,
        'side': side,
        'createdAt': createdAt,
        'favorite': favorite,
      };

  static List<HistoryEntry> listFromJsonList(List<String> list) =>
      list.map((s) => HistoryEntry.fromJson(jsonDecode(s) as Map<String, dynamic>)).toList();

  static List<String> listToJsonList(List<HistoryEntry> list) =>
      list.map((e) => jsonEncode(e.toJson())).toList();
}
DART

echo "== 2) Storage semplice su SharedPreferences =="
mkdir -p lib/utils
cat > lib/utils/storage.dart <<'DART'
import 'package:shared_preferences/shared_preferences.dart';
import 'package:whatifapp/models/history_entry.dart';

class Storage {
  static const _kHistory = 'history_v1';

  static Future<List<HistoryEntry>> getHistory() async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kHistory) ?? <String>[];
    return HistoryEntry.listFromJsonList(list).reversed.toList();
  }

  static Future<void> addHistory(HistoryEntry entry) async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kHistory) ?? <String>[];
    list.add(HistoryEntry.listToJsonList([entry]).first);
    await sp.setStringList(_kHistory, list);
  }

  static Future<void> toggleFavorite(String id) async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kHistory) ?? <String>[];
    final items = HistoryEntry.listFromJsonList(list);
    final idx = items.indexWhere((e) => e.id == id);
    if (idx >= 0) {
      items[idx] = items[idx].copyWith(favorite: !items[idx].favorite);
      await sp.setStringList(_kHistory, HistoryEntry.listToJsonList(items));
    }
  }

  static Future<void> clearHistory() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kHistory);
  }
}
DART

echo "== 3) Patch su lib/main.dart =="
# a) timeSide: -> side:
sed -i 's/\<timeSide\>:/side:/g' lib/main.dart

# b) rinomina la SECONDA occorrenza di 'final entry =' in 'final newEntry ='
awk '
  BEGIN{count=0}
  {
    if ($0 ~ /final[[:space:]]+entry[[:space:]]*=/) {
      count++
      if (count==2) sub(/final[[:space:]]+entry[[:space:]]*=/,"final newEntry =")
    }
    print
  }
' lib/main.dart > lib/main.dart.__tmp && mv lib/main.dart.__tmp lib/main.dart

# c) nella zona dopo la seconda occorrenza, cambia la prima addHistory(entry -> newEntry
awk '
  BEGIN{count=0; replaced=0}
  {
    if ($0 ~ /final[[:space:]]+entry[[:space:]]*=/) count++
    if (count>=2 && replaced==0 && $0 ~ /addHistory\([[:space:]]*entry[[:space:]]*\)/) {
      sub(/addHistory\([[:space:]]*entry[[:space:]]*\)/,"addHistory(newEntry)")
      replaced=1
    }
    print
  }
' lib/main.dart > lib/main.dart.__tmp && mv lib/main.dart.__tmp lib/main.dart

# d) assicura import di Storage e/o HistoryEntry se servono
grep -q "utils/storage.dart" lib/main.dart || \
sed -i "1s;^;import 'package:whatifapp/utils/storage.dart';\n;" lib/main.dart
grep -q "models/history_entry.dart" lib/main.dart || \
sed -i "1s;^;import 'package:whatifapp/models/history_entry.dart';\n;" lib/main.dart

echo "== 4) Clean + Get + Build web =="
flutter clean
flutter pub get -v
flutter build web --release --base-href "/WhatIfapp/" 2>&1 | tee build-web.log

echo "== 5) Ultime righe con 'Error' dal log =="
echo "----------------- POSSIBILI ERRORI -----------------"
tail -n 200 build-web.log | grep -nE "Error|Exception|Unhandled|FAIL|^E/|^W/" -n || echo "Nessun errore rilevato nel tail."
echo "----------------------------------------------------"
