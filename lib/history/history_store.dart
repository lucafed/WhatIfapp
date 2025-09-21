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
