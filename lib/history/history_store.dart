import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_entry.dart';

class HistoryStore extends ChangeNotifier {
  HistoryStore._();
  static final HistoryStore instance = HistoryStore._();

  static const _kHistory = 'history_v1';
  final List<HistoryEntry> _items = [];
  List<HistoryEntry> get items => List.unmodifiable(_items);

  Future<void> load() async {
    final sp = await SharedPreferences.getInstance();
    final s = sp.getString(_kHistory);
    _items
      ..clear()
      ..addAll(
        s == null
            ? const <HistoryEntry>[]
            : (jsonDecode(s) as List)
                .map((e) => HistoryEntry.fromJson(e as Map<String, dynamic>))
                .toList()
                .reversed, // più recente in alto
      );
    notifyListeners();
  }

  Future<void> _save() async {
    final sp = await SharedPreferences.getInstance();
    final list = _items.map((e) => e.toJson()).toList();
    await sp.setString(_kHistory, jsonEncode(list));
  }

  Future<void> add(HistoryEntry entry) async {
    _items.insert(0, entry);
    await _save();
    notifyListeners();
  }

  Future<void> toggleFavorite(String id) async {
    final i = _items.indexWhere((e) => e.id == id);
    if (i < 0) return;
    _items[i] = _items[i].copyWith(favorite: !_items[i].favorite);
    await _save();
    notifyListeners();
  }

  Future<void> clear() async {
    _items.clear();
    await _save();
    notifyListeners();
  }
}
