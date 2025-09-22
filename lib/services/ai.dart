import 'dart:math';
import '../models/result_entry.dart';

/// Interfaccia: in futuro puoi collegare OpenAI qui.
abstract class AiClient {
  Future<List<ResultEntry>> generate({
    required String question,
    required bool isFuture,
  });
}

/// Implementazione mock locale: genera due scenari coerenti + %.
class LocalMockAiClient implements AiClient {
  const LocalMockAiClient();

  int _seededProbability(String input, bool isFuture) {
    final s = '${input.toLowerCase()}|$isFuture';
    final hash = s.codeUnits.fold<int>(0, (a, c) => (a * 31 + c) & 0x7fffffff);
    return 5 + (hash % 91); // 5..95
  }

  String _realistic(String q, bool isFuture, int p) {
    final dir = isFuture ? 'futuro' : 'passato';
    return 'Scenario realistico ($dir): $q\n'
           'Probabilità stimata: $p%.\n'
           'Motivo: segnali e precedenti plausibili in questa direzione.';
  }

  String _wtf(String q, bool isFuture, int p) {
    const alibi = [
      "la convergenza dei pianeti",
      "un glitch nella matrice",
      "il gatto di Schrödinger col Wi-Fi",
      "una farfalla che sbatte le ali a Rimini",
    ];
    final pick = alibi[Random(q.hashCode).nextInt(alibi.length)];
    return 'What the F?!: $q\n'
           'Probabilità assurda ma possibile: $p%.\n'
           'Motivo ironico: $pick oggi è in vena.';
  }

  @override
  Future<List<ResultEntry>> generate({
    required String question,
    required bool isFuture,
  }) async {
    final p1 = _seededProbability(question, isFuture);
    final p2 = (100 - p1) - (p1 % 7);
    return [
      ResultEntry(
        scenario: 'slidingDoors',
        text: _realistic(question, isFuture, p1.clamp(5, 95)),
        probability: p1.clamp(5, 95),
      ),
      ResultEntry(
        scenario: 'whatTheF',
        text: _wtf(question, isFuture, (p2.abs()).clamp(5, 95)),
        probability: (p2.abs()).clamp(5, 95),
      ),
    ];
  }
}
