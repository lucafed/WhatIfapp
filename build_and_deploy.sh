#!/bin/bash
set -e

echo "📝 Sistemo pubspec.yaml per gli assets..."
if ! grep -q "assets/svg/" pubspec.yaml; then
  sed -i '/flutter:/a\  assets:\n    - assets/svg/\n    - assets/images/' pubspec.yaml
fi

echo "🧹 Pulizia e pacchetti..."
flutter clean
flutter pub get

echo "🌐 Compilo Flutter Web..."
flutter build web --release --base-href "/WhatIfapp/"

echo "�� Copio su gh-pages..."
git checkout gh-pages || git checkout -b gh-pages
rm -rf ./*
cp -r build/web/* .
git add .
git commit -m "deploy automatico"
git push origin gh-pages --force
git checkout main

echo "✅ Deploy completato!"
echo "👉 Apri: https://lucafed.github.io/WhatIfapp/"
