#!/usr/bin/env bash
set -euo pipefail

# 1. Patch main.dart: aggiungo bottone Cronologia dopo gli altri pulsanti
sed -i '/children: \[/a \
            ElevatedButton(\
              onPressed: () {\
                Navigator.push(\
                  context,\
                  MaterialPageRoute(builder: (_) => const HistoryPage()),\
                );\
              },\
              child: const Text("Cronologia"),\
            ),' lib/main.dart

# 2. Assicuro l'import di HistoryPage
if ! grep -q "import 'package:whatifapp/history/history_page.dart';" lib/main.dart; then
  sed -i '1i import "package:whatifapp/history/history_page.dart";' lib/main.dart
fi

# 3. Git add, commit e push
git add lib/main.dart
git commit -m "feat: aggiunto bottone Cronologia nell’home"
git push
