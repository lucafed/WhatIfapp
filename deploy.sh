#!/usr/bin/env bash
set -euo pipefail

APP_NAME="WhatIfapp"
BASE_HREF="/${APP_NAME}/"    # usato per GitHub Pages
BRANCH="gh-pages"
BUILD_DIR="build/web"

say() { printf "\n\033[1;36m➜ %s\033[0m\n" "$*"; }

say "Flutter clean"
flutter clean || true

say "Rimuovo cache locale (pubspec.lock & .dart_tool)"
rm -rf pubspec.lock .dart_tool || true

say "Scarico dipendenze (verboso)"
flutter pub get -v

say "Analisi rapida (non blocca il deploy)"
flutter analyze || true

say "Compilo WEB (verboso, release, base-href=${BASE_HREF})"
flutter build web -v --release --base-href "${BASE_HREF}"

# ------- Deploy su gh-pages -------
say "Preparo push su '${BRANCH}'"
# Salvo il branch corrente per tornare indietro dopo
CURR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Creo branch orfano temporaneo per pubblicare i file di build
git checkout --orphan "${BRANCH}" 2>/dev/null || git checkout "${BRANCH}" || git checkout -b "${BRANCH}"

# Svuoto l'indice e porto solo i file di build
git --work-tree "${BUILD_DIR}" add --all
git --work-tree "${BUILD_DIR}" commit -m "Deploy web ($(date -u +%F' '%T) UTC)" || true

say "Invio su remoto (${BRANCH})"
git push origin HEAD:"${BRANCH}" -f

# Torno al branch di lavoro e rimuovo l'orfano
git checkout -f "${CURR_BRANCH}"
git branch -D "${BRANCH}" >/dev/null 2>&1 || true

say "✅ Deploy completato!"
echo "Apri (dopo aver attivato GitHub Pages una sola volta):"
echo "https://$(git config user.name | tr '[:upper:]' '[:lower:]').github.io/${APP_NAME}/"
