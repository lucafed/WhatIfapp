import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

const _kHistory = 'history_v1';

class Storage {
  static Future<List<HistoryEntry>> getHistory() async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kHistory) ?? <String>[];
    return list
        .map((s) => jsonDecode(s) as Map<String, dynamic>)
        .map(HistoryEntry.fromJson)
        .toList()
        .reversed
        .toList();
  }

  static Future<void> addHistory(HistoryEntry e) async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList(_kHistory) ?? <String>[];
    list.add(jsonEncode(e.toJson()));
    await sp.setStringList(_kHistory, list);
  }
}
