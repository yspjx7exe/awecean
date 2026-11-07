$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) {
  $candidate = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $candidate) { $node = $candidate }
}
if (-not $node) {
  Write-Host 'Node.js was not found. Install Node.js 18+ first.' -ForegroundColor Red
  exit 1
}

$port = $env:PORT
if (-not $port) { $port = 4173 }
Write-Host 'Awecean' -ForegroundColor DarkCyan
Write-Host "http://127.0.0.1:$port" -ForegroundColor Cyan
& $node server.js
