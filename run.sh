#!/usr/bin/env bash
set -euo pipefail

# kill eventuali processi flutter rimasti appesi
pkill -f "flutter" 2>/dev/null || true

# trova una porta libera tra 8080, 8081, 8082
for P in 8080 8081 8082; do
  if ! lsof -iTCP:$P -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$P"
    break
  fi
done

echo "🚀 Avvio Whatifapp su porta $PORT..."
flutter clean >/dev/null 2>&1 || true
flutter pub get

# stampa URL comodo per Codespaces
if [[ -n "${CODESPACE_NAME-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN-}" ]]; then
  echo "🔗 Se non si apre da solo: https://${PORT}-${CODESPACE_NAME}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi
echo "👉 In alternativa apri la scheda PORTS e fai 'Open in Browser' sulla porta $PORT"

flutter run -d web-server --web-port "$PORT" --web-hostname 0.0.0.0
