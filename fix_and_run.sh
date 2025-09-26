#!/bin/bash
set -e

echo "🔧 Correggo riferimenti agli assets..."
grep -rl "assets/assets/" lib/ | xargs sed -i 's|assets/assets/|assets/|g' || true

echo "📂 Controllo pubspec.yaml..."
if ! grep -q "assets/svg/" pubspec.yaml; then
  echo "  assets:" >> pubspec.yaml
  echo "    - assets/svg/" >> pubspec.yaml
fi

echo "🧹 Pulizia e installazione pacchetti..."
flutter clean
flutter pub get

echo "🌐 Compilo per il web..."
flutter build web --release

echo "🚀 Avvio server su porta 8080..."
python3 -m http.server 8080 --directory build/web
