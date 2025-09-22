#!/bin/bash
set -e

echo "🚀 Inizio build Flutter Web..."
flutter build web --release --base-href "/WhatIfapp/"

echo "📦 Build completata, avvio deploy..."
bash deploy_web.sh

echo "✅ Deploy completato! L'app è online su:"
echo "👉 https://lucafed.github.io/WhatIfapp/"
