#!/usr/bin/env bash
set -euo pipefail

FILE="lib/main.dart"

# Sostituisce qualsiasi blocco "final entry/newEntry = HistoryEntry(...);"
# con la versione completa e corretta (id, question, scenario, side, createdAt)
perl -0777 -i -pe '
s/final\s+(?:newEntry|entry)\s*=\s*HistoryEntry\s*\([^)]*\);/final newEntry = HistoryEntry(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      question: q,
      scenario: _scenario == ScenarioType.slidingDoors ? "slidingDoors" : "whatTheF",
      side: _isFuture ? "future" : "past",
      createdAt: DateTime.now().toIso8601String(),
    );/s
' "$FILE"

# Se dopo la creazione non c’è salvataggio, lo aggiunge una volta sola.
grep -q "Storage\.addHistory(newEntry)" "$FILE" || \
  sed -i '/newEntry = HistoryEntry/,${
    /Storage\.addHistory(newEntry)/!{
      /newEntry = HistoryEntry/{
        n
        a \ \ \ \ await Storage.addHistory(newEntry);
      }
    }
  }' "$FILE"

echo "Patch applicata a $FILE"
