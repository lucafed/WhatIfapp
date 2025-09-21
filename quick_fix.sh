#!/usr/bin/env bash
set -euo pipefail

FILE="lib/main.dart"

# 1) Rimuovi eventuali duplicati di "final entry"
perl -0777 -i -pe 's/final\s+entry\s*=\s*HistoryEntry\s*\([^)]*\);\s*/\/\* duplicate removed \*\//s' "$FILE"

# 2) Rimpiazza qualsiasi blocco con la versione corretta
perl -0777 -i -pe '
s/final\s+(?:newEntry|entry)\s*=\s*HistoryEntry\s*\([^)]*\);/final newEntry = HistoryEntry(
  id: DateTime.now().millisecondsSinceEpoch.toString(),
  question: q,
  scenario: _scenario == ScenarioType.slidingDoors ? "slidingDoors" : "whatTheF",
  side: _isFuture ? "future" : "past",
  createdAt: DateTime.now().toIso8601String(),
);/s
' "$FILE"

# 3) Forza il salvataggio solo con HistoryStore
sed -i 's/Storage\.addHistory(newEntry);/HistoryStore.instance.add(newEntry);/g' "$FILE"

echo "✅ main.dart sistemato!"
