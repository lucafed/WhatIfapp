import '../models/history_entry.dart';

enum ScenarioType { slidingDoors, whatTheF }

class AIResult {
  final String realisticAnswer;
  final int realisticProbability;
  final String funAnswer;
  final int funProbability;
  AIResult({
    required this.realisticAnswer,
    required this.realisticProbability,
    required this.funAnswer,
    required this.funProbability,
  });
}

/// Interfaccia per poter poi sostituire lo stub con un provider HTTP reale
abstract class AIProvider {
  Future<AIResult> generate({
    required String question,
    required bool isFuture,
  });
}

/// Implementazione STUB (locale, zero costi)
class StubAIProvider implements AIProvider {
  @override
  Future<AIResult> generate({required String question, required bool isFuture}) async {
    await Future.delayed(const Duration(milliseconds: 400));
    final polarity = isFuture ? 'nel futuro' : 'nel passato';
    final pReal = (question.hashCode.abs() % 60) + 20; // 20..79
    final pFun  = 100 - (pReal ~/ 2);                  // giusto per variare

    return AIResult(
      realisticAnswer:
          "Scenario realistico: se cambi qualcosa $polarity di \"$question\", "
          "l'effetto a catena rimane circoscritto. Probabile esito positivo se agisci con metodo.",
      realisticProbability: pReal,
      funAnswer:
          "Scenario WTF?!: apri la porta e trovi un piccione che ti consegna una laurea honoris causa. "
          "Poi tutto esplode di colori e capisci che era un sogno… o forse no 🤯",
      funProbability: pFun,
    );
  }
}

// Helper per creare una HistoryEntry a partire dal risultato AI
HistoryEntry makeEntry({
  required String question,
  required bool isFuture,
  required ScenarioType scenario,
  required String answer,
  required int probability,
}) {
  final id = DateTime.now().millisecondsSinceEpoch.toString();
  return HistoryEntry(
    id: id,
    question: question,
    scenario: scenario == ScenarioType.slidingDoors ? 'slidingDoors' : 'whatTheF',
    side: isFuture ? 'future' : 'past',
    answer: answer,
    probability: probability,
    createdAt: DateTime.now().toIso8601String(),
  );
}
