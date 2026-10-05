# Pull the latest code and restart the server. Run from the repo folder:  .\scripts\windows\update.ps1
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
git pull --ff-only
Stop-ScheduledTask -TaskName 'MacNutriLogger' -ErrorAction SilentlyContinue
# stop only the node.exe that is running THIS repo's server
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$repo*server*" -or $_.CommandLine -like '*server\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'MacNutriLogger'
Write-Host 'Updated and restarted.'
