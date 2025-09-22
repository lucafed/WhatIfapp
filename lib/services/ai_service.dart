import 'dart:math';

/// Stub di AI locale (senza chiamate esterne).
/// In futuro sostituisci l'implementazione con OpenAI, mantenendo la stessa API.
class AiService {
  static final _rnd = Random();

  static Future<Map<String, dynamic>> generate({
    required String question,
    required String side, // 'past' | 'future'
  }) async {
    await Future.delayed(const Duration(milliseconds: 400));

    // Realistico
    final probReal = 40 + _rnd.nextInt(51); // 40..90
    final answerReal =
        side == 'future'
            ? "Scenario realistico: probabilmente $probReal% che accada X se ${question.toLowerCase()}."
            : "Scenario realistico: con $probReal% di probabilità, se cambiavi Y allora ${question.toLowerCase()}.";

    // Ironico
    final probWtf = 10 + _rnd.nextInt(81); // 10..90
    final answerWtf =
        side == 'future'
            ? "Scenario WHAT THE F?!: un lama cosmico ti offre $probWtf% di chance… e tu accetti."
            : "Scenario WHAT THE F?!: tornando indietro, incontri il tuo io del passato al  $probWtf% e discutete sul gelato.";

    return {
      'answerReal': answerReal,
      'probReal': probReal,
      'answerWtf': answerWtf,
      'probWtf': probWtf,
    };
  }
}
