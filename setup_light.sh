#!/usr/bin/env bash
set -euo pipefail

echo "⚡ Setup leggero (loghi + pubspec + pub get)..."

# 1) Loghi
mkdir -p assets/logos
declare -A svgs=(
  ["assets/logos/whatif_door.svg"]='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#0A0F14"/><rect x="60" y="20" width="80" height="160" fill="#00E0FF" stroke="#1AFFD5" stroke-width="6"/><circle cx="125" cy="100" r="6" fill="#1AFFD5"/></svg>'
  ["assets/logos/whatif_bar.svg"]='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#0A0F14"/><path d="M80 30 h40 v80 q0 30 -20 40 q-20 -10 -20 -40z" fill="#00E0FF" stroke="#1AFFD5" stroke-width="6"/><rect x="90" y="150" width="20" height="30" fill="#00B5CC"/></svg>'
)

for f in "${!svgs[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "🖼️ Creo logo mancante: $f"
    echo "${svgs[$f]}" > "$f"
  else
    echo "✅ Logo già presente: $f"
  fi
done

# 2) Assicura pubspec.yaml aggiornato
if ! grep -q "assets/logos/" pubspec.yaml; then
  echo "🔧 Aggiorno pubspec.yaml..."
  echo "  assets:" >> pubspec.yaml
  echo "    - assets/logos/" >> pubspec.yaml
fi

# 3) Dipendenze
flutter pub get
echo "✅ Setup leggero completato!"
