import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

class HistoryStore {
  static const _kKey = 'whatif_history_v1';
  HistoryStore._();
  static final HistoryStore instance = HistoryStore._();

  Future<List<HistoryEntry>> all() async {
    final sp = await SharedPreferences.getInstance();
    return HistoryEntry.decodeList(sp.getString(_kKey));
  }

  Future<void> add(HistoryEntry entry) async {
    final sp = await SharedPreferences.getInstance();
    final list = await all();
    list.insert(0, entry);
    await sp.setString(_kKey, HistoryEntry.encodeList(list));
  }

  Future<void> like(String id) async {
    final sp = await SharedPreferences.getInstance();
    final list = await all();
    for (final e in list) {
      if (e.id == id) { e.likes += 1; break; }
    }
    await sp.setString(_kKey, HistoryEntry.encodeList(list));
  }

  Future<void> clear() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kKey);
  }
}
