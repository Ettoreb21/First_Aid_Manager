#!/usr/bin/env bash
# Avvia First Aid Manager Node.js e apre nel browser quando pronto
BASE_URL="http://localhost:3000"
HEALTH_PATH="/"

set -euo pipefail
cd "$(dirname "$0")/.."

# Termina eventuali processi Node.js sulla porta 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Installa dipendenze se necessario
if [ ! -d "node_modules" ]; then
    npm install
fi

# Avvia server Node.js in background
npm start &
SERVER_PID=$!

# Attesa che l'endpoint risponda 200
URL="${BASE_URL%/}${HEALTH_PATH}"
echo "Avvio server in corso..."
until curl -sSf "$URL" >/dev/null 2>&1; do
  sleep 1
  echo "Attendo che il server sia pronto..."
done

echo "✅ Server avviato con successo!"
# Apre nel browser predefinito
open "${BASE_URL}"

# Mantieni lo script attivo
echo "Premi Ctrl+C per fermare il server"
wait $SERVER_PID