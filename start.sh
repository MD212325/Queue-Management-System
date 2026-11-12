#!/bin/bash

echo "Starting Queue Management System..."

echo ""
echo "Running npm install in root directory..."
npm install

echo ""
echo "Starting server..."
node server.js &
SERVER_PID=$!

echo ""
echo "Opening new terminal window for frontend..."
gnome-terminal -- bash -c "cd frontend && npm install && npm run dev" 2>/dev/null || \
xterm -e "cd frontend && npm install && npm run dev" 2>/dev/null || \
x-terminal-emulator -e "cd frontend && npm install && npm run dev" 2>/dev/null || \
echo "Please manually run in another terminal: cd frontend && npm install && npm run dev"

echo ""
echo "Setup complete!"
echo "Server is running with PID: $SERVER_PID"
