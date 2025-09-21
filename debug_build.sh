#!/usr/bin/env bash
set -euo pipefail

echo "🧹 flutter clean…"
flutter clean || true

echo "📦 flutter pub get…"
flutter pub get -v

echo "🏗️  build web (base-href=/WhatIfapp/)…"
# Log verboso su file (senza --web-renderer)
flutter build web -v --release --base-href "/WhatIfapp/" 2>&1 | tee build-web.log

echo "✅ Build terminata. Estraggo eventuali righe di errore:"
echo "-------------------------------- ERRORS (se presenti) -------------------------------"
grep -nEi "ERROR|Exception|Unhandled|FAIL|^E/|^W/" build-web.log || echo "Nessun ERROR trovato nel log."
echo "-------------------------------------------------------------------------------------"
