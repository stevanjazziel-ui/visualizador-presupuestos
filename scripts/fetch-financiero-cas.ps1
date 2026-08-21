[CmdletBinding()]
param(
  [string]$Username = "TELLOC",
  [string]$Password = "TELLOC"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$directOutputPath = Join-Path $repoRoot "data\sync-source\financiero-direct-scrape.json"
$syncSourcePath = Join-Path $repoRoot "data\sync-source\latest.json"
$nodePath = "C:\Users\PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

function Get-NumberValue {
  param([object]$Value)

  if ($null -eq $Value) {
    return 0.0
  }

  if ($Value -is [System.Collections.IDictionary] -and $Value.Contains("decimal")) {
    return [double]$Value["decimal"]
  }

  if ($Value.PSObject.Properties.Name -contains "decimal") {
    return [double]$Value.decimal
  }

  return [double]$Value
}

$serviceUrl = "https://egobfinanciero.gadmriobamba.gob.ec:8000/#riobamba"
$casLoginUrl = "https://egob.gadmriobamba.gob.ec:8443/cas/login?service=$([uri]::EscapeDataString($serviceUrl))"
$cookieJarPath = Join-Path $env:TEMP "financiero-cas-cookies.txt"
$loginHtmlPath = Join-Path $env:TEMP "financiero-cas-login.html"
$headersPath = Join-Path $env:TEMP "financiero-cas-headers.txt"
$authHtmlPath = Join-Path $env:TEMP "financiero-cas-auth.html"

foreach ($tempPath in @($cookieJarPath, $loginHtmlPath, $headersPath, $authHtmlPath)) {
  if (Test-Path -LiteralPath $tempPath) {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
}

curl.exe -s -L -c $cookieJarPath -b $cookieJarPath $casLoginUrl -o $loginHtmlPath | Out-Null
$loginPage = Get-Content -LiteralPath $loginHtmlPath -Raw
$executionMatch = [regex]::Match($loginPage, 'name="execution"[^>]*value="([^"]+)"')
if (-not $executionMatch.Success) {
  throw "No se encontro el token execution del CAS."
}

$formBody = "username=$([uri]::EscapeDataString($Username))&password=$([uri]::EscapeDataString($Password))&execution=$([uri]::EscapeDataString($executionMatch.Groups[1].Value))&_eventId=submit&geolocation="
curl.exe -s -D $headersPath -L -c $cookieJarPath -b $cookieJarPath -H "Content-Type: application/x-www-form-urlencoded" --data $formBody $casLoginUrl -o $authHtmlPath | Out-Null

$headersRaw = Get-Content -LiteralPath $headersPath -Raw
$ticketMatch = [regex]::Match($headersRaw, 'Location:\s+https://egobfinanciero\.gadmriobamba\.gob\.ec:8000/\?ticket=([^ \r\n]+)')
if (-not $ticketMatch.Success) {
  throw "No se encontro el ticket CAS en la respuesta final."
}
$ticket = $ticketMatch.Groups[1].Value

$loginPayload = @{
  id = 0
  method = "common.db.login"
  params = @($ticket, @{}, "en")
} | ConvertTo-Json -Compress -Depth 20

$rpcLogin = Invoke-RestMethod `
  -Uri "https://egobfinanciero.gadmriobamba.gob.ec:8000/riobamba/" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginPayload

if ($null -eq $rpcLogin.result -or $rpcLogin.result.Count -lt 2) {
  throw "El backend no devolvio una sesion Tryton valida."
}

$userId = [int]$rpcLogin.result[0]
$sessionId = [string]$rpcLogin.result[1]
$authToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(("{0}:{1}:{2}" -f $ticket, $userId, $sessionId)))

$context = @{
  context_model = "public.planning.unit.context"
  advanced_filters = $false
  category_filter = $null
  company = 2
  compromise = $false
  cost_center = $null
  department = $null
  direction = $null
  drag_filter = "complete"
  end_date = @{ __class__ = "date"; year = 2026; month = 12; day = 31 }
  exp_category = $null
  funding_code = ""
  ods_goal = $null
  ods_indicator = $null
  ods_target = $null
  orientation = $null
  participatory_budget = $false
  participatory_budget_filter = ""
  poa = 10095
  poa_end_date = @{ __class__ = "date"; year = 2026; month = 12; day = 31 }
  poa_start_date = @{ __class__ = "date"; year = 2026; month = 1; day = 1 }
  posted = $true
  priority_group = $null
  program = $null
  project = $null
  requirement_type = $null
  start_date = @{ __class__ = "date"; year = 2026; month = 1; day = 1 }
  strategic_axis = $null
}

$fields = @(
  "code",
  "type",
  "kind",
  "level",
  "initial_amount",
  "reform_amount",
  "codified_amount",
  "certified_amount",
  "committed_amount",
  "accrued_amount",
  "executed_amount",
  "certified_pending",
  "accrued_pending",
  "executed_pending"
)

$searchPayload = @{
  id = 2
  method = "model.public.budget.card.search_read"
  params = @(
    @(@("type", "=", "expense")),
    0,
    5000,
    $null,
    $fields,
    $context
  )
} | ConvertTo-Json -Compress -Depth 30

$rowsResponse = Invoke-RestMethod `
  -Uri "https://egobfinanciero.gadmriobamba.gob.ec:8000/riobamba/" `
  -Method Post `
  -Headers @{ Authorization = "Session $authToken" } `
  -ContentType "application/json" `
  -Body $searchPayload

$rows = @($rowsResponse.result) | Where-Object {
  $_.type -eq "expense" -and $_.code -match '^\d{2}\.\d{2}\.\d{2}\.\d{4}\.\d+\.\d+(?:\.\d+){4,5}$'
} | ForEach-Object {
  [ordered]@{
    code = [string]$_.code
    initial_amount = Get-NumberValue $_.initial_amount
    reform_amount = Get-NumberValue $_.reform_amount
    codified_amount = Get-NumberValue $_.codified_amount
    certified_amount = Get-NumberValue $_.certified_amount
    committed_amount = Get-NumberValue $_.committed_amount
    accrued_amount = Get-NumberValue $_.accrued_amount
    executed_amount = Get-NumberValue $_.executed_amount
    certified_pending = Get-NumberValue $_.certified_pending
    accrued_pending = Get-NumberValue $_.accrued_pending
    executed_pending = Get-NumberValue $_.executed_pending
  }
}

$payload = [ordered]@{
  meta = [ordered]@{
    source = "financiero-cas-rpc"
    capturedAt = [DateTime]::UtcNow.ToString("o")
    rowCount = $rows.Count
    ticket = $ticket
  }
  rows = $rows
}

$payload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $directOutputPath -Encoding UTF8

powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\import-financiero-direct.ps1") -DirectSourcePath $directOutputPath -SyncSourcePath $syncSourcePath
& $nodePath (Join-Path $repoRoot "scripts\sync-budget-viewer-data.mjs") --source $syncSourcePath
& $nodePath (Join-Path $repoRoot "scripts\build-published-viewer.mjs")
& $nodePath (Join-Path $repoRoot "scripts\validate-published-viewer.mjs")

[ordered]@{
  ticket = $ticket
  userId = $userId
  rows = $rows.Count
  directOutputPath = $directOutputPath
  syncSourcePath = $syncSourcePath
} | ConvertTo-Json -Depth 10
