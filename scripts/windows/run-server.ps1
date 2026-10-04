# Started by the 'MacNutriLogger' scheduled task at boot. Loads data\.env, runs the server, logs to data\server.log.
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
$envFile = Join-Path $repo 'data\.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim() } }
}
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$log = Join-Path $repo 'data\server.log'
& $node server\server.js *>> $log
