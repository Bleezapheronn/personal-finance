param(
  [Parameter(Mandatory = $true)]
  [string]$RuntimeConfigPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($RuntimeConfigPath)) {
  throw "A valid absolute runtime config path is required."
}

$launcher = Join-Path $repoRoot "server\src\runtimeLauncher.ts"
$tsx = Join-Path $repoRoot "server\node_modules\tsx\dist\cli.mjs"

# This foreground process owns both children. It deliberately performs no API,
# SQLite, or readiness gate and never opens a browser.
& node.exe $tsx $launcher "--runtime-config" $RuntimeConfigPath
exit $LASTEXITCODE
