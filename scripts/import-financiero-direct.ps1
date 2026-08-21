[CmdletBinding()]
param(
  [string]$DirectSourcePath = "",
  [string]$SyncSourcePath = "",
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

if ([string]::IsNullOrWhiteSpace($DirectSourcePath)) {
  $DirectSourcePath = Join-Path $PSScriptRoot "..\data\sync-source\financiero-direct-scrape.json"
}

if ([string]::IsNullOrWhiteSpace($SyncSourcePath)) {
  $SyncSourcePath = Join-Path $PSScriptRoot "..\data\sync-source\latest.json"
}

function Resolve-NodePath {
  $bundled = "C:\Users\PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path -LiteralPath $bundled) {
    return $bundled
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $node) {
    return $node.Source
  }

  throw "No se encontro Node.js."
}

function Get-DirectionCodeFromPartida {
  param([string]$Partida)

  $parts = $Partida.Split(".")
  if ($parts.Length -lt 6) {
    return $null
  }

  return "{0}.{1}.{2}" -f $parts[3], $parts[4], $parts[5]
}

function Round-Value {
  param([decimal]$Value)

  return [double]([math]::Round($Value, 2))
}

function Update-PayloadFromDirectRows {
  param(
    [object[]]$Rows,
    [string]$PayloadPath
  )

  $payload = Get-Content -LiteralPath $PayloadPath -Raw | ConvertFrom-Json
  $itemsByCode = @{}
  foreach ($item in $payload.items) {
    $itemsByCode[$item.code] = $item
  }

  $totalsByDirection = @{}
  foreach ($row in $Rows) {
    $directionCode = Get-DirectionCodeFromPartida -Partida $row.code
    if ([string]::IsNullOrWhiteSpace($directionCode)) {
      continue
    }

    if (-not $itemsByCode.ContainsKey($directionCode)) {
      continue
    }

    if (-not $totalsByDirection.ContainsKey($directionCode)) {
      $totalsByDirection[$directionCode] = [ordered]@{
        Codificado = [decimal]::Zero
        Certificado = [decimal]::Zero
        Comprometido = [decimal]::Zero
        Devengado = [decimal]::Zero
        Ejecutado = [decimal]::Zero
        PendienteCertificar = [decimal]::Zero
      }
    }

    $totalsByDirection[$directionCode].Codificado += [decimal]$row.codified_amount
    $totalsByDirection[$directionCode].Certificado += [decimal]$row.certified_amount
    $totalsByDirection[$directionCode].Comprometido += [decimal]$row.committed_amount
    $totalsByDirection[$directionCode].Devengado += [decimal]$row.accrued_amount
    $totalsByDirection[$directionCode].Ejecutado += [decimal]$row.executed_amount
    $totalsByDirection[$directionCode].PendienteCertificar += [decimal]$row.certified_pending
  }

  $changed = $false
  foreach ($entry in $totalsByDirection.GetEnumerator()) {
    $item = $itemsByCode[$entry.Key]

    $nextCodificado = Round-Value $entry.Value.Codificado
    $nextCertificado = Round-Value $entry.Value.Certificado
    $nextComprometido = Round-Value $entry.Value.Comprometido
    $nextDevengado = Round-Value $entry.Value.Devengado
    $nextEjecutado = Round-Value $entry.Value.Ejecutado
    $nextPendienteCertificar = Round-Value $entry.Value.PendienteCertificar
    $nextPendienteDevengar = Round-Value ($entry.Value.Comprometido - $entry.Value.Devengado)
    $nextPendienteEjecutar = Round-Value ($entry.Value.Devengado - $entry.Value.Ejecutado)

    $currentCertificado = if ($null -ne $item.PSObject.Properties["certificado"]) { [double]$item.certificado } else { 0 }
    $currentComprometido = if ($null -ne $item.PSObject.Properties["comprometido"]) { [double]$item.comprometido } else { 0 }
    $currentDevengado = if ($null -ne $item.PSObject.Properties["devengado"]) { [double]$item.devengado } else { 0 }
    $currentEjecutado = if ($null -ne $item.PSObject.Properties["ejecutado"]) { [double]$item.ejecutado } else { 0 }
    $currentPendienteCertificar = if ($null -ne $item.PSObject.Properties["pendienteCertificar"]) { [double]$item.pendienteCertificar } else { 0 }
    $currentPendienteDevengar = if ($null -ne $item.PSObject.Properties["pendienteDevengar"]) { [double]$item.pendienteDevengar } else { 0 }
    $currentPendienteEjecutar = if ($null -ne $item.PSObject.Properties["pendienteEjecutar"]) { [double]$item.pendienteEjecutar } else { 0 }

    if (
      ($item.codificado -ne $nextCodificado) -or
      ($currentCertificado -ne $nextCertificado) -or
      ($currentComprometido -ne $nextComprometido) -or
      ($currentDevengado -ne $nextDevengado) -or
      ($currentEjecutado -ne $nextEjecutado) -or
      ($currentPendienteCertificar -ne $nextPendienteCertificar) -or
      ($currentPendienteDevengar -ne $nextPendienteDevengar) -or
      ($currentPendienteEjecutar -ne $nextPendienteEjecutar)
    ) {
      $changed = $true
    }

    $item.codificado = $nextCodificado
    $item | Add-Member -NotePropertyName certificado -NotePropertyValue $nextCertificado -Force
    $item | Add-Member -NotePropertyName comprometido -NotePropertyValue $nextComprometido -Force
    $item | Add-Member -NotePropertyName devengado -NotePropertyValue $nextDevengado -Force
    $item | Add-Member -NotePropertyName ejecutado -NotePropertyValue $nextEjecutado -Force
    $item | Add-Member -NotePropertyName pendienteCertificar -NotePropertyValue $nextPendienteCertificar -Force
    $item | Add-Member -NotePropertyName pendienteDevengar -NotePropertyValue $nextPendienteDevengar -Force
    $item | Add-Member -NotePropertyName pendienteEjecutar -NotePropertyValue $nextPendienteEjecutar -Force
  }

  if ($changed) {
    $payload.meta.updatedAt = [DateTime]::UtcNow.ToString("o")
    $json = $payload | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $PayloadPath), "$json`n", [System.Text.UTF8Encoding]::new($false))
  }

  return [pscustomobject]@{
    DirectionsUpdated = $totalsByDirection.Count
    LeafRowsUsed = $Rows.Count
    Changed = $changed
  }
}

$resolvedDirectSourcePath = Resolve-Path -LiteralPath $DirectSourcePath
$resolvedSyncSourcePath = Resolve-Path -LiteralPath $SyncSourcePath
$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")

$directPayload = Get-Content -LiteralPath $resolvedDirectSourcePath -Raw | ConvertFrom-Json
$rows = @($directPayload.rows)
if ($rows.Count -eq 0) {
  throw "La fuente directa no contiene filas."
}

$update = Update-PayloadFromDirectRows -Rows $rows -PayloadPath $resolvedSyncSourcePath

$result = [ordered]@{
  directSourcePath = [string]$resolvedDirectSourcePath
  directionsUpdated = $update.DirectionsUpdated
  leafRowsUsed = $update.LeafRowsUsed
  changed = $update.Changed
  syncSourcePath = [string]$resolvedSyncSourcePath
}

if ($Publish) {
  $nodePath = Resolve-NodePath

  & $nodePath (Join-Path $repoRoot "scripts\sync-budget-viewer-data.mjs") --source $resolvedSyncSourcePath
  if ($LASTEXITCODE -ne 0) { throw "Fallo sync-budget-viewer-data.mjs." }

  & $nodePath (Join-Path $repoRoot "scripts\build-published-viewer.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Fallo build-published-viewer.mjs." }

  & $nodePath (Join-Path $repoRoot "scripts\validate-published-viewer.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Fallo validate-published-viewer.mjs." }

  Push-Location $repoRoot
  try {
    git -c core.safecrlf=false add data/sync-source/latest.json data/budget-viewer-data.json public/budget-viewer-data.js public/budget-viewer-data.json public/sync-source/latest.json scripts/import-financiero-direct.ps1 package.json
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit -m "chore: sync financiero direct scrape"
      $pushOutput = git push 2>&1
      if ($LASTEXITCODE -ne 0) {
        throw ($pushOutput | Out-String)
      }
      $pushOutput | ForEach-Object { Write-Output $_ }
      $result.published = $true
    } else {
      $result.published = $false
    }
  }
  finally {
    Pop-Location
  }
}

$result | ConvertTo-Json -Depth 10
