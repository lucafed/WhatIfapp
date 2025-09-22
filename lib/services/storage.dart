import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

class Storage {
  static const _kKey = 'whatif_history_v2';

  static Future<List<HistoryEntry>> loadHistory() async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kKey) ?? <String>[];
    return list.map(HistoryEntry.fromJson).toList();
  }

  static Future<void> saveHistory(List<HistoryEntry> items) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setStringList(_kKey, items.map((e) => e.toJson()).toList());
  }

  static Future<void> addHistory(HistoryEntry e) async {
    final items = await loadHistory();
    items.insert(0, e);
    await saveHistory(items);
  }

  static Future<void> updateLiked(String id, bool liked) async {
    final items = await loadHistory();
    final i = items.indexWhere((x) => x.id == id);
    if (i >= 0) {
      items[i] = items[i].copyWith(liked: liked);
      await saveHistory(items);
    }
  }

  static Future<void> clear() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kKey);
  }
}
