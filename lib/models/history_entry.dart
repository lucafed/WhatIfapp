import 'dart:convert';

class HistoryEntry {
  final String id;
  final String question;
  final String side; // 'past' | 'future'
  final String scenario; // 'slidingDoors' | 'whatTheF'
  final String createdAt; // ISO
  // risultati
  final String answerReal;
  final int probReal; // 0..100
  final String answerWtf;
  final int probWtf; // 0..100
  final bool liked;

  const HistoryEntry({
    required this.id,
    required this.question,
    required this.side,
    required this.scenario,
    required this.createdAt,
    required this.answerReal,
    required this.probReal,
    required this.answerWtf,
    required this.probWtf,
    this.liked = false,
  });

  HistoryEntry copyWith({bool? liked}) => HistoryEntry(
        id: id,
        question: question,
        side: side,
        scenario: scenario,
        createdAt: createdAt,
        answerReal: answerReal,
        probReal: probReal,
        answerWtf: answerWtf,
        probWtf: probWtf,
        liked: liked ?? this.liked,
      );

  Map<String, dynamic> toMap() => {
        'id': id,
        'question': question,
        'side': side,
        'scenario': scenario,
        'createdAt': createdAt,
        'answerReal': answerReal,
        'probReal': probReal,
        'answerWtf': answerWtf,
        'probWtf': probWtf,
        'liked': liked,
      };

  static HistoryEntry fromMap(Map<String, dynamic> m) => HistoryEntry(
        id: m['id'],
        question: m['question'],
        side: m['side'],
        scenario: m['scenario'],
        createdAt: m['createdAt'],
        answerReal: m['answerReal'],
        probReal: (m['probReal'] ?? 0) as int,
        answerWtf: m['answerWtf'],
        probWtf: (m['probWtf'] ?? 0) as int,
        liked: (m['liked'] ?? false) as bool,
      );

  String toJson() => jsonEncode(toMap());
  static HistoryEntry fromJson(String s) => fromMap(jsonDecode(s));

  @override
  String toString() => 'HistoryEntry($question • $side/$scenario)';
}
