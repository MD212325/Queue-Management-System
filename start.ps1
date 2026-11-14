# Installs and builds only when needed, then runs the server.
# Use ".\start.ps1 rebuild" after changing the admin console.
param([string]$Mode = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Starting Queue Management System..."

if (-not (Test-Path "node_modules")) { Write-Host "Installing server packages..."; npm install }
if (-not (Test-Path "frontend/node_modules")) { Write-Host "Installing admin console packages..."; npm --prefix frontend install }
if ($Mode -eq "rebuild" -or -not (Test-Path "frontend/dist/index.html")) {
  Write-Host "Building the admin console..."
  npm --prefix frontend run build
}
if (-not (Test-Path ".env")) { Write-Host "NOTE: there is no .env file yet. Copy .env.example to .env and set STAFF_KEY." }

Write-Host ""
node server.js
