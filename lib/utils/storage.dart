import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

class Storage {
  static const _kHistory = 'history_entries_v1';

  static Future<List<HistoryEntry>> loadHistory() async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kHistory) ?? <String>[];
    return list.map(HistoryEntry.fromJson).toList().reversed.toList();
  }

  static Future<void> saveHistory(List<HistoryEntry> items) async {
    final sp = await SharedPreferences.getInstance();
    final list = items.map((e) => e.toJson()).toList().reversed.toList();
    await sp.setStringList(_kHistory, list);
  }

  static Future<void> addHistory(HistoryEntry entry) async {
    final items = await loadHistory();
    items.add(entry);
    await saveHistory(items);
  }

  static Future<void> toggleLike(HistoryEntry entry) async {
    final items = await loadHistory();
    final idx = items.indexWhere((e) =>
      e.createdAt == entry.createdAt && e.question == entry.question);
    if (idx != -1) {
      items[idx] = HistoryEntry(
        question: items[idx].question,
        scenario: items[idx].scenario,
        timeSide: items[idx].timeSide,
        createdAt: items[idx].createdAt,
        liked: !items[idx].liked,
      );
      await saveHistory(items);
    }
  }

  static Future<void> clearHistory() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kHistory);
  }
}
