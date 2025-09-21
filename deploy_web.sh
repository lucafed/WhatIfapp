#!/usr/bin/env bash
set -euo pipefail

APP_NAME="WhatIfapp"                 # nome repo x base-href e URL
BUILD_DIR="build/web"
GH_DIR="build/gh-pages"

echo "🧹 flutter clean"
flutter clean

echo "📦 flutter pub get"
flutter pub get

echo "��️  build web (base-href=/${APP_NAME}/)"
flutter build web --release --base-href "/${APP_NAME}/"

echo "🌿 prepara worktree gh-pages"
git fetch origin || true
git worktree remove --force "${GH_DIR}" 2>/dev/null || true

# Prova ad agganciare la remota gh-pages, altrimenti crea branch locale
if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
  git worktree add -B gh-pages "${GH_DIR}" origin/gh-pages
else
  git worktree add -B gh-pages "${GH_DIR}"
fi

echo "📤 copia artefatti"
rsync -av --delete "${BUILD_DIR}/" "${GH_DIR}/" >/dev/null

# Evita che GitHub Pages applichi Jekyll
touch "${GH_DIR}/.nojekyll"

echo "✅ commit & push"
cd "${GH_DIR}"
git add -A
git commit -m "deploy(web): $(date -u +'%Y-%m-%d %H:%M:%S')"
git push -f origin gh-pages

echo "🚀 online: https://lucafed.github.io/${APP_NAME}/"
