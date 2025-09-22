import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

class Storage {
  static const _kHistory = 'history_v1';
  static const _kLikes = 'likes_v1';
  static const _kQuotaPrefix = 'quota_'; // es: quota_20250130 -> 3

  /// Salva una entry in testa alla lista
  static Future<void> addHistory(HistoryEntry e) async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_kHistory) ?? <String>[];
    // prepend
    list.insert(0, e.toJson());
    await prefs.setStringList(_kHistory, list);
  }

  static Future<List<HistoryEntry>> getHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_kHistory) ?? <String>[];
    return list.map(HistoryEntry.fromJson).toList();
  }

  static Future<void> clearHistory() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kHistory);
  }

  // Like per id (persistiti separatamente per sicurezza)
  static Future<Map<String, int>> _readLikes() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kLikes);
    if (raw == null) return {};
    return Map<String, int>.from(jsonDecode(raw) as Map);
  }

  static Future<void> like(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final likes = await _readLikes();
    likes[id] = (likes[id] ?? 0) + 1;
    await prefs.setString(_kLikes, jsonEncode(likes));

    // Aggiorna anche la lista history
    final list = prefs.getStringList(_kHistory) ?? <String>[];
    final updated = list.map((s) {
      final e = HistoryEntry.fromJson(s);
      if (e.id == id) {
        e.likes += 1;
      }
      return e.toJson();
    }).toList();
    await prefs.setStringList(_kHistory, updated);
  }

  static Future<List<HistoryEntry>> top10() async {
    final all = await getHistory();
    all.sort((a, b) => b.likes.compareTo(a.likes));
    return all.take(10).toList();
  }

  // Quota giornaliera (3 al giorno nella free)
  static Future<int> getTodayCount() async {
    final prefs = await SharedPreferences.getInstance();
    final key = _todayKey();
    return prefs.getInt(key) ?? 0;
    }

  static Future<void> incToday() async {
    final prefs = await SharedPreferences.getInstance();
    final key = _todayKey();
    final v = (prefs.getInt(key) ?? 0) + 1;
    await prefs.setInt(key, v);
  }

  static String _todayKey() {
    final now = DateTime.now();
    final d = '${now.year}${now.month.toString().padLeft(2,'0')}${now.day.toString().padLeft(2,'0')}';
    return '$_kQuotaPrefix$d';
  }
}
