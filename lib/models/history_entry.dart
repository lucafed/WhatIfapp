import 'dart:convert';

class HistoryEntry {
  final String question;
  final String scenario; // Sliding Doors | What the F.?
  final String timeSide; // Passato | Futuro
  final DateTime createdAt;
  bool liked; // like/dislike semplice

  HistoryEntry({
    required this.question,
    required this.scenario,
    required this.timeSide,
    required this.createdAt,
    this.liked = false,
  });

  Map<String, dynamic> toMap() => {
    'q': question,
    's': scenario,
    't': timeSide,
    'c': createdAt.toIso8601String(),
    'l': liked,
  };

  static HistoryEntry fromMap(Map<String, dynamic> m) => HistoryEntry(
    question: m['q'] as String,
    scenario: m['s'] as String,
    timeSide: m['t'] as String,
    createdAt: DateTime.parse(m['c'] as String),
    liked: (m['l'] as bool?) ?? false,
  );

  String toJson() => jsonEncode(toMap());
  static HistoryEntry fromJson(String s) => fromMap(jsonDecode(s));
}
