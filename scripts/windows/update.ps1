# Pull the latest code and restart the server. Run from the repo folder:  .\scripts\windows\update.ps1
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
git pull --ff-only
Stop-ScheduledTask -TaskName 'MacNutriLogger' -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*nodejs*' } | Stop-Process -Force
Start-ScheduledTask -TaskName 'MacNutriLogger'
Write-Host 'Updated and restarted.'
