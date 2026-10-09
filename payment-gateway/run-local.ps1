param(
  [Parameter(Position = 0)]
  [ValidateSet("dev", "prod")]
  [string]$Mode = "dev",

  [Parameter(Position = 1)]
  [ValidateSet("api", "worker", "migrate")]
  [string]$Component = "api"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Mode -eq "prod") {
  throw "Local production mode is disabled. Follow payment-gateway/docs/deployment.md on the production host."
}

$backendEnvPath = Join-Path $repoRoot "back-end\.env.development"
$productionEnvPath = Join-Path $repoRoot "back-end\.env.production"

function Read-EnvFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Environment file not found: $Path" }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    if ($trimmed -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $value = $Matches[2].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$Matches[1]] = $value
    }
  }
  return $values
}

$backendEnv = Read-EnvFile $backendEnvPath
$productionEnv = Read-EnvFile $productionEnvPath
$database = $backendEnv["MONGODB_DATABASE"]
if (-not $database -or -not $backendEnv["MONGODB_URI"]) {
  throw "MONGODB_URI or MONGODB_DATABASE is missing from back-end/.env.development."
}
if ($database -eq $productionEnv["MONGODB_DATABASE"] -and $database -ne "louma") {
  throw "Development and production currently use the same MongoDB database. Set MONGODB_DATABASE in back-end/.env.development to an isolated louma_gateway_test* database before starting the test gateway. Node and Go must share that sandbox database for ledger consistency."
}
if ($database -ne "louma" -and -not $database.StartsWith("louma_gateway_test")) {
  throw "The development database must be louma (the confirmed Atlas test database) or start with louma_gateway_test."
}

$gatewayEnv = Read-EnvFile (Join-Path $PSScriptRoot ".env.test")
if ($gatewayEnv["GATEWAY_ENVIRONMENT"] -ne "test") {
  throw "Set GATEWAY_ENVIRONMENT=test in payment-gateway/.env.test."
}
foreach ($requiredKey in @("GATEWAY_SERVICE_KEY", "GATEWAY_API_KEY_PEPPER", "GATEWAY_ENCRYPTION_KEY")) {
  if (-not $gatewayEnv[$requiredKey]) { throw "$requiredKey is missing from payment-gateway/.env.test." }
}
if ($backendEnv["PAYMENT_GATEWAY_TEST_SERVICE_KEY"] -ne $gatewayEnv["GATEWAY_SERVICE_KEY"]) {
  throw "PAYMENT_GATEWAY_TEST_SERVICE_KEY in back-end/.env.development must match GATEWAY_SERVICE_KEY in payment-gateway/.env.test."
}

$gatewayEnv["GATEWAY_MONGODB_URI"] = $backendEnv["MONGODB_URI"]
$gatewayEnv["GATEWAY_DATABASE"] = $database
if ($gatewayEnv["GATEWAY_REDIS_URL"] -eq "redis://redis:6379") {
  $gatewayEnv["GATEWAY_REDIS_URL"] = ""
}
foreach ($name in $gatewayEnv.Keys) {
  [Environment]::SetEnvironmentVariable($name, $gatewayEnv[$name], "Process")
}

if ($Component -eq "api") {
  $address = $gatewayEnv["GATEWAY_ADDRESS"]
  if (-not $address) { $address = "127.0.0.1:8090" }
  if ($address -notmatch ":(\d+)$") { throw "GATEWAY_ADDRESS must end with a TCP port." }
  $port = [int]$Matches[1]
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($listeners) {
    $owners = ($listeners.OwningProcess | Sort-Object -Unique) -join ","
    $healthUrl = "http://127.0.0.1:$port/healthz"
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
      if ($health.StatusCode -eq 200) {
        Write-Host "[INFO] Gateway API is already running at $healthUrl (HTTP 200; PID $owners). This command exits without starting a duplicate. Stop that process before restarting." -ForegroundColor Green
        exit 0
      }
    } catch { }
    Write-Host "[ERROR] TCP port $port is already in use by PID $owners. Close that process or change GATEWAY_ADDRESS." -ForegroundColor Red
    exit 1
  }
}

if ($Component -eq "worker") {
  $runningWorker = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'go\.exe.*run \./cmd/worker' }
  if ($runningWorker) {
    Write-Host "[INFO] Gateway worker is already running (PID $($runningWorker[0].ProcessId)). Close its existing window before starting another." -ForegroundColor Green
    exit 0
  }
}

Write-Host "[INFO] Starting Gateway $Component ($Mode) ..." -ForegroundColor Cyan
Push-Location $PSScriptRoot
try {
  if ($Component -eq "migrate") {
    & go run ./cmd/migrate "-confirm-database=$database"
  } else {
    & go run "./cmd/$Component"
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
