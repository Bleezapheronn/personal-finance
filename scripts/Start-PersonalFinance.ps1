param(
  [Parameter(Mandatory = $false)]
  [string]$ProfilePath = $env:PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH,
  [switch]$OpenBrowser,
  [string]$BrowserPath
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

& node.exe $authorityCli $authoritySource --profile $ProfilePath status
if ($LASTEXITCODE -ne 0) {
  throw "Personal Finance is not ready to start. Run the checkpoint shortcut if a checkpoint is required."
}

$profile = Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
$apiUrl = "http://$($profile.apiHost):$($profile.apiPort)"
$viteUrl = "http://$($profile.viteHost):$($profile.vitePort)"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdout = Join-Path $env:TEMP "personal-finance-start-$stamp.out.log"
$stderr = Join-Path $env:TEMP "personal-finance-start-$stamp.err.log"
$arguments = @(
  $authorityCli,
  $authoritySource,
  "--profile",
  $ProfilePath,
  "start"
)

$process = Start-Process -FilePath node.exe -ArgumentList $arguments `
  -WorkingDirectory $repoRoot -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if ($process.HasExited) {
      throw "Personal Finance stopped before it became ready."
    }
    try {
      $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 2
      $vite = Invoke-WebRequest -Uri $viteUrl -TimeoutSec 2 -UseBasicParsing
      if ($health.ok -eq $true -and $vite.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) {
    throw "Personal Finance did not become ready in time."
  }
  Write-Host "Personal Finance is ready at $viteUrl"
  Write-Host "Open this URL in your preferred browser."
  if ($OpenBrowser) {
    if ($BrowserPath) {
      if (-not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
        throw "The requested browser path is unavailable."
      }
      Start-Process -FilePath $BrowserPath -ArgumentList $viteUrl
    } else {
      Start-Process $viteUrl
    }
  }
  Write-Host "Keep this window open. Close it or press Ctrl+C to stop the app."
  Wait-Process -Id $process.Id
} catch {
  Write-Error $_
  if (Test-Path -LiteralPath $stderr) {
    Get-Content -LiteralPath $stderr -Tail 20
  }
  throw
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
  }
}
