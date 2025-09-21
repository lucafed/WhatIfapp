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

  Map<String, dynamic> toJson() => {
        'id': id,
        'question': question,
        'scenario': scenario,
        'side': side,
        'createdAt': createdAt,
        'favorite': favorite,
      };

  static HistoryEntry fromJson(Map<String, dynamic> m) => HistoryEntry(
        id: m['id'] as String,
        question: m['question'] as String,
        scenario: m['scenario'] as String,
        side: (m['side'] ?? m['timeSide'] ?? 'future') as String,
        createdAt: m['createdAt'] as String,
        favorite: (m['favorite'] as bool?) ?? false,
      );

  static String encodeList(List<HistoryEntry> items) =>
      jsonEncode(items.map((e) => e.toJson()).toList());

  static List<HistoryEntry> decodeList(String s) {
    final raw = jsonDecode(s) as List;
    return raw.map((e) => HistoryEntry.fromJson(e as Map<String, dynamic>)).toList();
  }
}
