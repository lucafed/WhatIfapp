#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8080}"

echo "🔧 Flutter pub get..."
flutter pub get

echo "🧱 Build Web (no cache, base-href / per Codespaces)..."
flutter build web --release --pwa-strategy=none --base-href "/"

echo "🧹 Libero la porta ${PORT} se occupata..."
( command -v fuser >/dev/null 2>&1 && fuser -k "${PORT}"/tcp ) || true

echo "🚀 Serving su http://0.0.0.0:${PORT}  (apri dalla tab Ports → Public → HTTPS)"
python3 -m http.server "${PORT}" --directory build/web
