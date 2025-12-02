Write-Host "Starting Queue Management System..."

Write-Host ""
Write-Host "Running npm install in root directory..."
npm install

Write-Host ""
Write-Host "Starting server..."
Start-Process node -ArgumentList "server.js"

Write-Host ""
Write-Host "Opening new PowerShell window for frontend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm install; npm run dev"

Write-Host ""
Write-Host "Setup complete!"
