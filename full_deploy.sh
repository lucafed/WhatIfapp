#!/bin/bash
set -euo pipefail

trap 'echo "❌ Qualcosa è andato storto (riga $LINENO). Controlla l’output sopra."' ERR

echo "🔧 Fix testi (rimozione parentesi nell’onboarding)…"
LIST=$(grep -RIl --include="*.dart" -E 'Sliding[[:space:]]+Doors|What[[:space:]]+the[[:space:]]+F\?\!' lib || true)
if [ -n "${LIST:-}" ]; then
  TS=$(date +%s)
  while IFS= read -r f; do
    cp -n "$f" "$f.bak.$TS" || true
    sed -i -E \
      -e 's/(Sliding[[:space:]]+Doors)[[:space:]]*\(realistico\)/\1/g' \
      -e 's/(What[[:space:]]+the[[:space:]]+F\?\!)[[:space:]]*\(ironico\)/\1/g' \
      "$f"
    echo "• Aggiornato: $f"
  done <<< "$LIST"
else
  echo "• Niente da aggiornare 👍"
fi

echo "⚙️ Build web (release, base-href /WhatIfapp/)…"
flutter build web --release --base-href "/WhatIfapp/"

echo "☁️ Deploy su GitHub Pages…"
bash deploy_web.sh

echo "🧹 Pulizia backup vecchi (> 2 giorni)…"
find . -type f -name "*.bak.*" -mtime +2 -print -delete || true

echo
echo "✅ Tutto fatto!"
echo "👉 Apri: https://lucafed.github.io/WhatIfapp/"
