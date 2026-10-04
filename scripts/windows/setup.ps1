# One-time setup for an always-on Windows laptop. Run in an ADMINISTRATOR PowerShell from the repo folder:
#   Set-ExecutionPolicy -Scope Process Bypass -Force; .\scripts\windows\setup.ps1
# Safe to re-run.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path

function Need-Winget($id) {
  if (-not (winget list --id $id -e 2>$null | Select-String $id)) {
    winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  }
}

Write-Host '1/5 Installing Node.js LTS and Tailscale (skips ones already installed)...'
Need-Winget 'OpenJS.NodeJS.LTS'
Need-Winget 'Tailscale.Tailscale'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host '2/5 Admin token...'
$envFile = Join-Path $repo 'data\.env'
New-Item -ItemType Directory -Force (Split-Path $envFile) | Out-Null
if (-not (Test-Path $envFile)) {
  $token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  "ADMIN_TOKEN=$token`nPORT=3000" | Set-Content -Encoding ascii $envFile
  Write-Host "   Created $envFile  (your admin token: $token)"
} else { Write-Host "   Keeping existing $envFile" }

Write-Host '3/5 Auto-start the server at boot (Task Scheduler, restarts if it crashes)...'
$ps = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\windows\run-server.ps1`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'MacNutriLogger' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'MacNutriLogger'

Write-Host '4/5 Keep the laptop awake on power and when the lid is closed...'
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT

Write-Host '5/5 Done with the automatic part. Remaining manual steps (see docs\WINDOWS.md):'
Write-Host '   a) Open Tailscale from the Start menu and sign in.'
Write-Host '   b) In a normal PowerShell run:  tailscale serve --bg 3000'
Write-Host '   c) Install Tailscale on your phone, sign in to the same account, open the https://...ts.net link it prints.'
Start-Sleep 3
try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/data).StatusCode | ForEach-Object { Write-Host "   Server check: HTTP $_" } } catch { Write-Host '   Server not answering yet; check data\server.log' }
