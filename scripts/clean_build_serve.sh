#!/usr/bin/env bash
set -euo pipefail

echo "🔄 flutter clean..."
flutter clean || true

echo "📦 flutter pub get..."
flutter pub get

echo "��️ flutter build web (release)..."
flutter build web --release

if [[ ! -f build/web/index.html ]]; then
  echo "❌ Build non riuscita: file build/web/index.html mancante."
  exit 1
fi

# Chiudo eventuali server http precedenti
pkill -f "python3 -m http.server" >/dev/null 2>&1 || true

# Trovo una porta libera tra 8090-8099 (fallback 8090)
PORT=""
for p in {8090..8099}; do
  if ! ss -ltn 2>/dev/null | awk "{print \$4}" | grep -q ":$p\$"; then
    PORT="$p"; break
  fi
done
: "\${PORT:=8090}"

echo "✅ Build OK."
echo "🚀 Avvio server su porta \${PORT}…"
echo "🔗 URL locale: http://localhost:\${PORT}"
echo "💡 In Codespaces apri la porta \${PORT} dalla tab PORTS (oppure usa l’URL inoltrato)."

python3 -m http.server "\${PORT}" --directory build/web
