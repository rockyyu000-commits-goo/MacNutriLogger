# Copies the database (your edits + logged-in data lives in the browser, not here) to a dated backup. Run any time:
#   .\scripts\windows\backup.ps1 [-To D:\backups]
param([string]$To = "$env:USERPROFILE\Documents\MacNutriLogger-backups")
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
New-Item -ItemType Directory -Force $To | Out-Null
Copy-Item "$repo\data\db.json" (Join-Path $To ("db-" + (Get-Date -Format 'yyyyMMdd-HHmm') + ".json"))
Write-Host "Backed up to $To"
