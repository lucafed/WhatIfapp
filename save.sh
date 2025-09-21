#!/usr/bin/env bash
set -euo pipefail

MSG="${1:-Aggiornamento rapido}"

git add .
git commit -m "$MSG" || echo "⚠️ Nessun cambiamento da committare"
git push
