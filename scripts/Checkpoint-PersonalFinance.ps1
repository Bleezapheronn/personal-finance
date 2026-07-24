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

$profile = Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
foreach ($endpoint in @(
  @{ Host = $profile.apiHost; Port = [int]$profile.apiPort },
  @{ Host = $profile.viteHost; Port = [int]$profile.vitePort }
)) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync($endpoint.Host, $endpoint.Port)
    if ($connect.Wait(500) -and $client.Connected) {
      throw "Stop Personal Finance before creating a checkpoint."
    }
  } finally {
    $client.Dispose()
  }
}

$statusOutput = & node.exe $authorityCli $authoritySource `
  --profile $ProfilePath status 2>&1
$statusCode = $LASTEXITCODE
if ($statusCode -eq 0) {
  Write-Host "No checkpoint is required. Personal Finance is ready to start."
  exit 0
}
if (($statusOutput -join "`n") -notmatch "authority_checkpoint_required") {
  $statusOutput | Write-Host
  throw "Authority status failed for a reason other than a required checkpoint."
}

$label = "routine-" + (Get-Date -Format "yyyyMMdd-HHmmss")
& node.exe $authorityCli $authoritySource --profile $ProfilePath checkpoint --label $label
if ($LASTEXITCODE -ne 0) {
  throw "Checkpoint creation failed."
}
& node.exe $authorityCli $authoritySource --profile $ProfilePath verify
if ($LASTEXITCODE -ne 0) {
  throw "Checkpoint verification failed."
}
Write-Host "Checkpoint verified. Personal Finance is safe to restart."
