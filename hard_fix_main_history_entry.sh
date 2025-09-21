#!/usr/bin/env bash
set -euo pipefail

FILE="lib/main.dart"

# 0) Assicura import di utils/storage.dart
grep -q "utils/storage.dart" "$FILE" || sed -i "1s;^;import 'utils/storage.dart';\n;" "$FILE"

# 1) Compat: timeSide -> side
sed -i 's/\btimeSide\s*:/side: /g' "$FILE"

# 2) Se esistono due dichiarazioni (la "prima" va via): commenta solo la PRIMA occorrenza di 'final entry = HistoryEntry('
perl -0777 -i -pe '
my $cnt = 0;
s{
  (final\s+entry\s*=\s*HistoryEntry\s*\()   # apertura
  (.*?)                                     # corpo argomenti
  (\);\s*)                                   # chiusura
}{
  ++$cnt == 1
    ? "// REMOVED (legacy duplicate)\n// $1$2$3"
    : "$1$2$3"
}gsex
' "$FILE"

# 3) Rimpiazza qualunque blocco entry/newEntry con il modello "giusto"
perl -0777 -i -pe '
s{
  final\s+(?:newEntry|entry)\s*=\s*HistoryEntry\s*\([^)]*\);\s*
}{
final newEntry = HistoryEntry(
  id: DateTime.now().millisecondsSinceEpoch.toString(),
  question: q,
  scenario: _scenario == ScenarioType.slidingDoors ? "slidingDoors" : "whatTheF",
  side: _isFuture ? "future" : "past",
  createdAt: DateTime.now().toIso8601String(),
);
await Storage.addHistory(newEntry);
HistoryStore.instance.add(newEntry);

}gsx
' "$FILE"

echo "✅ Patch applicata a $FILE"
