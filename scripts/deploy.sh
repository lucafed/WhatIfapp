#!/usr/bin/env bash
set -euo pipefail

# --- Parametri/auto-detect ---
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
BASE_HREF="/$REPO_NAME/"
BUILD_DIR="build/web"
PUBLISH_DIR="build/gh-pages"   # cartella di lavoro per il branch gh-pages

echo "📦 Repo: $REPO_NAME"
echo "🔗 base-href: $BASE_HREF"

# --- Pre-check: Flutter & gh ---
if ! command -v flutter >/dev/null 2>&1; then
  echo "❌ Flutter non trovato nel PATH."
  echo "Apri una shell dove 'flutter --version' funziona e rilancia lo script."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ GitHub CLI (gh) non trovato. Installa e fai login: https://cli.github.com/"
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "❌ Non sei loggato su gh. Esegui: gh auth login"
  exit 1
fi

# --- Build Flutter Web (niente cache PWA) ---
echo "🔨 flutter pub get…"
flutter pub get

echo "🏗️ flutter build web (release)…"
flutter build web \
  --release \
  --pwa-strategy=none \
  --base-href "$BASE_HREF"

# --- Prepara worktree per gh-pages (pulita e separata da main) ---
echo "🌿 Preparo worktree per gh-pages in $PUBLISH_DIR…"
rm -rf "$PUBLISH_DIR"
git worktree add -B gh-pages "$PUBLISH_DIR" origin/gh-pages 2>/dev/null || git worktree add -B gh-pages "$PUBLISH_DIR"

# --- Copia artefatti di build nella worktree ---
echo "📤 Copio artefatti ($BUILD_DIR → $PUBLISH_DIR)…"
rsync -a --delete "$BUILD_DIR"/ "$PUBLISH_DIR"/

# --- Commit & push su gh-pages ---
pushd "$PUBLISH_DIR" >/dev/null

# Evita che Jekyll filtri file (classico per GitHub Pages)
touch .nojekyll

git add -A
if ! git diff --cached --quiet; then
  git commit -m "Deploy: $(date -u +'%Y-%m-%d %H:%M:%S')"
  git push origin gh-pages
else
  echo "ℹ️ Nessuna modifica da pubblicare."
fi

popd >/dev/null

# --- Attiva / aggiorna GitHub Pages a servire da gh-pages ---
echo "🌐 Configuro GitHub Pages su branch gh-pages…"
gh api \
  --method PUT \
  "repos/{owner}/{repo}/pages" \
  -f "source[branch]=gh-pages" \
  -f "source[path]=/" >/dev/null || true

PAGES_URL="https://$(gh repo view --json owner,name -q '.owner.login')\.github.io/$REPO_NAME/"
echo
echo "✅ Deploy completato!"
echo "🔗 URL pubblico: $PAGES_URL"
echo "⏳ Se non si apre subito, attendi 1–2 minuti (cache GitHub Pages)."
