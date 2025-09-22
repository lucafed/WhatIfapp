#!/usr/bin/env bash
set -euo pipefail

echo "⚙️  Setup WhatIfapp…"

flutter clean
flutter pub get
flutter build web --release --base-href "/WhatIfapp/"

echo "🎉 Build completata. Cartella: build/web"
