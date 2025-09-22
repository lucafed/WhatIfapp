import 'dart:convert';

class HistoryEntry {
  final String id;
  final String question;
  final String scenario; // 'slidingDoors' | 'whatTheF'
  final String side;     // 'past' | 'future'
  final String createdAt; // ISO 8601
  int likes;
  final double probabilityReal;
  final double probabilityWtf;
  final String answerReal;
  final String answerWtf;

  HistoryEntry({
    required this.id,
    required this.question,
    required this.scenario,
    required this.side,
    required this.createdAt,
    this.likes = 0,
    required this.probabilityReal,
    required this.probabilityWtf,
    required this.answerReal,
    required this.answerWtf,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'question': question,
        'scenario': scenario,
        'side': side,
        'createdAt': createdAt,
        'likes': likes,
        'probabilityReal': probabilityReal,
        'probabilityWtf': probabilityWtf,
        'answerReal': answerReal,
        'answerWtf': answerWtf,
      };

  factory HistoryEntry.fromJson(Map<String, dynamic> map) => HistoryEntry(
        id: map['id'],
        question: map['question'],
        scenario: map['scenario'],
        side: map['side'],
        createdAt: map['createdAt'],
        likes: (map['likes'] ?? 0) as int,
        probabilityReal: (map['probabilityReal'] ?? 0.0).toDouble(),
        probabilityWtf: (map['probabilityWtf'] ?? 0.0).toDouble(),
        answerReal: map['answerReal'] ?? '',
        answerWtf: map['answerWtf'] ?? '',
      );

  static String encodeList(List<HistoryEntry> items) =>
      jsonEncode(items.map((e) => e.toJson()).toList());

  static List<HistoryEntry> decodeList(String? s) {
    if (s == null || s.isEmpty) return [];
    final list = jsonDecode(s) as List<dynamic>;
    return list.map((e) => HistoryEntry.fromJson(e)).toList();
  }
}
