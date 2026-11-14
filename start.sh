#!/bin/bash
# Installs and builds only when needed, then runs the server. Use "./start.sh rebuild" after changing the admin console.
set -e
cd "$(dirname "$0")"
echo "Starting Queue Management System..."

[ -d node_modules ] || { echo "Installing server packages..."; npm install; }
[ -d frontend/node_modules ] || { echo "Installing admin console packages..."; npm --prefix frontend install; }
if [ "$1" = "rebuild" ] || [ ! -f frontend/dist/index.html ]; then
  echo "Building the admin console..."
  npm --prefix frontend run build
fi
[ -f .env ] || echo "NOTE: there is no .env file yet. Copy .env.example to .env and set STAFF_KEY."

echo
exec node server.js
