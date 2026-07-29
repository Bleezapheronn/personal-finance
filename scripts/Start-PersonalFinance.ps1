param(
  [Parameter(Mandatory = $false)]
  [string]$ProfilePath = $env:PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$authorityCli = Join-Path $repoRoot "server\node_modules\tsx\dist\cli.mjs"
$authoritySource = Join-Path $repoRoot "server\src\authorityOps.ts"

if (-not $ProfilePath -or -not [System.IO.Path]::IsPathRooted($ProfilePath)) {
  throw "A valid absolute authority profile path is required."
}
if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
  throw "The authority profile is unavailable."
}

$arguments = @($authorityCli, $authoritySource, "--profile", $ProfilePath, "run")
& node.exe $arguments
if ($LASTEXITCODE -ne 0) { throw "Personal Finance supervised run failed." }
