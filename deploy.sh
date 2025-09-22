#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Deploy WhatIfapp su GitHub Pages…"

# Build
flutter build web --release --base-href "/WhatIfapp/"

# Push su GitHub (branch main)
git add -A
git commit -m "chore(ci): build & deploy"
git push

echo "✅ Push completato. GitHub Actions avvierà il deploy su Pages."
echo "⏳ Attendi 1-2 minuti e controlla qui: https://lucafed.github.io/WhatIfapp/"
