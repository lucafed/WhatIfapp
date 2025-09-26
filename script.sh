#!/usr/bin/env bash
set -euo pipefail

APP="whatif-pwa"

echo "📦 Creo struttura $APP ..."

mkdir -p $APP/public/{css,js,logos,icons}

# index.html
cat > $APP/public/index.html <<'EOF'
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>WhatIfApp</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <h1>🍺🚪 Benvenuto in WhatIfApp!</h1>
  <p>Scegli la tua porta o il tuo bar.</p>
  <button onclick="alert('Entri nella porta!')">🚪 Porta</button>
  <button onclick="alert('Vai al bar!')">🍺 Bar</button>
  <script src="js/app.js"></script>
</body>
</html>
EOF

# style.css
cat > $APP/public/css/style.css <<'EOF'
body {
  background: #0A0F14;
  color: #FFFFFF;
  font-family: sans-serif;
  text-align: center;
  padding: 2rem;
}
button {
  background: #00E0FF;
  border: none;
  color: #0A0F14;
  padding: 1rem 2rem;
  margin: 1rem;
  font-size: 1.2rem;
  border-radius: 12px;
  cursor: pointer;
}
button:hover {
  background: #1AFFD5;
}
EOF

# app.js
cat > $APP/public/js/app.js <<'EOF'
console.log("WhatIfApp pronto!");
EOF

# manifest
cat > $APP/public/manifest.webmanifest <<'EOF'
{
  "name": "WhatIfApp",
  "short_name": "WhatIf",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#0A0F14",
  "theme_color": "#00E0FF",
  "icons": []
}
EOF

echo "✅ Struttura creata in $APP/public"
echo "👉 Avvia server locale con: python3 -m http.server 8090 --directory $APP/public"
