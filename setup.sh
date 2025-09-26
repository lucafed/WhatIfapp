#!/usr/bin/env bash
set -euo pipefail

say() { printf "\n\033[1;36m%s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m%s\033[0m\n" "$*"; }
err() { printf "\n\033[1;31m%s\033[0m\n" "$*"; }

ROOT="$(pwd)"

# ──────────────────────────────────────────────────────────────────────────────
# 0) FLUTTER: installa se manca, fissa il PATH e fa retry se serve
# ──────────────────────────────────────────────────────────────────────────────
ensure_flutter() {
  if ! command -v flutter >/dev/null 2>&1; then
    say "⬇️  Installo Flutter (stable) localmente…"
    mkdir -p "$HOME/codespace"
    if [ ! -d "$HOME/codespace/flutter" ]; then
      git clone --branch stable --depth 1 https://github.com/flutter/flutter.git "$HOME/codespace/flutter"
    fi
    export PATH="$HOME/codespace/flutter/bin:$PATH"
  fi

  # primo tentativo
  if ! flutter --version >/dev/null 2>&1; then
    warn "Flutter non risponde; ripulisco cache e ritento…"
    export PATH="$HOME/codespace/flutter/bin:$PATH"
    hash -r || true
    # piccolo bootstrap per evitare sospensioni strane
    "$HOME/codespace/flutter/bin/flutter" precache --web || true
    sleep 1
  fi

  # secondo tentativo (fail esplicito se ancora rotto)
  if ! flutter --version >/dev/null 2>&1; then
    err "❌ Flutter ancora non disponibile (env corrotto). Chiudi e riapri il terminale, poi rilancia ./setup.sh"
    exit 1
  fi

  say "✅ Flutter: $(flutter --version | head -n1)"
}

# ──────────────────────────────────────────────────────────────────────────────
# 1) LOGHI SVG (creo se mancano)
# ──────────────────────────────────────────────────────────────────────────────
ensure_logos() {
  say "🖼️  Controllo/creo loghi in assets/logos/…"
  mkdir -p assets/logos

  DOOR=assets/logos/whatif_door.svg
  BAR=assets/logos/whatif_bar.svg

  if [ ! -f "$DOOR" ]; then
    cat > "$DOOR" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#10F0FF"/>
      <stop offset="100%" stop-color="#06222A"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" fill="#0A0F14"/>
  <rect x="50" y="25" width="100" height="150" rx="6" fill="url(#g)" stroke="#14FFE0" stroke-width="6"/>
  <rect x="70" y="45" width="70" height="110" rx="2" fill="#041418"/>
  <circle cx="125" cy="100" r="6" fill="#14FFE0"/>
</svg>
SVG
    say "➕ creato $DOOR"
  else
    say "✔︎ presente $DOOR"
  fi

  if [ ! -f "$BAR" ]; then
    cat > "$BAR" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#0A0F14"/>
  <g stroke="#14FFE0" stroke-width="5" fill="none">
    <rect x="50" y="70" width="100" height="80" rx="8"/>
    <line x1="60" y1="70" x2="60" y2="40" stroke="#FF55FF"/>
    <line x1="80" y1="70" x2="80" y2="40" stroke="#FFD84D"/>
    <line x1="100" y1="70" x2="100" y2="40" stroke="#55FF9A"/>
    <line x1="120" y1="70" x2="120" y2="40" stroke="#55A2FF"/>
    <line x1="140" y1="70" x2="140" y2="40" stroke="#FF6E6E"/>
  </g>
  <rect x="55" y="75" width="90" height="55" rx="6" fill="#02222A" stroke="#14FFE0" stroke-width="3"/>
  <rect x="75" y="135" width="50" height="25" rx="4" fill="#00BBD4"/>
</svg>
SVG
    say "➕ creato $BAR"
  else
    say "✔︎ presente $BAR"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# 2) PUBSPEC: assicura la cartella assets/logos/
# ──────────────────────────────────────────────────────────────────────────────
ensure_pubspec() {
  say "🛠️  Aggiorno pubspec.yaml (se serve)…"
  if ! grep -qE '^\s*assets:\s*$' pubspec.yaml 2>/dev/null; then
    # se non c’è proprio la sezione assets, la aggiungo alla fine
    printf "\nflutter:\n  uses-material-design: true\n  assets:\n    - assets/logos/\n" >> pubspec.yaml
    say "➕ aggiunta sezione flutter/assets in coda"
  else
    # se c'è assets:, mi assicuro che includa assets/logos/
    if ! grep -q 'assets/logos/' pubspec.yaml; then
      awk 'BEGIN{p=1} {print} /assets:/{if(p){print "    - assets/logos/"; p=0}}' pubspec.yaml > pubspec.yaml.new \
        && mv pubspec.yaml.new pubspec.yaml
      say "➕ aggiunto assets/logos/ sotto assets:"
    else
      say "✔︎ assets/logos/ già presente"
    fi
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# 3) BUILD + SERVE
# ──────────────────────────────────────────────────────────────────────────────
build_and_serve() {
  say "📦 flutter pub get…"
  flutter pub get

  say "🧱 flutter build web --release…"
  flutter build web --release

  # trova porta libera 8090–8099
  PORT=""
  for p in $(seq 8090 8099); do
    if ! ss -ltn 2>/dev/null | grep -q ":$p "; then PORT="$p"; break; fi
  done
  if [ -z "${PORT:-}" ]; then
    err "Nessuna porta libera 8090–8099"; exit 1
  fi

  say "🚀 Avvio server statico su porta $PORT (build/web)"
  # URL Codespaces “amichevole”, se variabili presenti
  if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
    say "🔗 URL: $URL"
  fi
  python3 -m http.server "$PORT" --directory build/web
}

# ──────────────────────────────────────────────────────────────────────────────

say "🔧 Setup (flutter, loghi, pubspec, build, serve)…"
ensure_flutter
ensure_logos
ensure_pubspec
build_and_serve
