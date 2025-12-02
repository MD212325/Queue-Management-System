@echo off
echo Starting Queue Management System...

echo.
echo Running npm install in root directory...
call npm install

echo.
echo Starting server...
start node server.js

echo.
echo Opening new cmd window for frontend...
start cmd /k "cd frontend && npm install && npm run dev"

echo.
echo Setup complete!