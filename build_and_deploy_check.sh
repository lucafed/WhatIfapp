#!/bin/bash
set -e

echo "🔎 Controllo assets dichiarati in pubspec.yaml..."

# Estrai tutte le righe assets:
grep "assets/" pubspec.yaml | sed 's/- //' | while read asset; do
  if [ ! -e "$asset" ]; then
    echo "❌ Manca il file: $asset"
    missing=1
  fi
done

if [ "$missing" == "1" ]; then
  echo "🚨 Alcuni asset mancano, build interrotto."
  exit 1
fi

echo "✅ Tutti gli asset trovati!"

echo "🧹 Pulizia build..."
flutter clean
flutter pub get

echo "🌐 Build Flutter Web..."
flutter build web --release --base-href "/WhatIfapp/"

echo "🚀 Deploy su GitHub Pages..."
git checkout gh-pages || git checkout -b gh-pages
rm -rf ./*
cp -r build/web/* .
git add .
git commit -m "deploy automatico"
git push origin gh-pages --force
git checkout main

echo "✅ Fatto!"
echo "👉 App online fra 1–2 minuti: https://lucafed.github.io/WhatIfapp/"
