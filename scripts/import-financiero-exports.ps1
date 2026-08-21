[CmdletBinding()]
param(
  [string]$SourceDir = "$env:USERPROFILE\Downloads",
  [string]$Pattern = "Partida XLS-*.xls",
  [string]$SyncSourcePath = "",
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

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

function Resolve-PythonPath {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($null -ne $python) {
    return $python.Source
  }

  throw "No se encontro Python."
}

function Convert-ToDecimal {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return [decimal]::Zero
  }

  $normalized = $Value.Trim().Replace(".", "").Replace(",", ".")
  return [decimal]::Parse($normalized, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Find-HeaderMap {
  param($Worksheet)

  for ($row = 1; $row -le 25; $row++) {
    $headers = @{}
    for ($col = 1; $col -le 20; $col++) {
      $text = [string]$Worksheet.Cells.Item($row, $col).Text
      if ([string]::IsNullOrWhiteSpace($text)) {
        continue
      }

      $normalized = $text.Trim().ToUpperInvariant()
      switch ($normalized) {
        "PARTIDA" { $headers.partida = $col }
        "NOMBRE" { $headers.nombre = $col }
        "MONTO INICIAL" { $headers.initial = $col }
        "CANTIDA REFORMA" { $headers.reforma = $col }
        "MONTO CODIFICADO" { $headers.codificado = $col }
        "MONTO CERTIFICADO" { $headers.certificado = $col }
        "MONTO COMPROMETIDO" { $headers.comprometido = $col }
        "MONTO DEVENGADO" { $headers.devengado = $col }
        "MONTO EJECUTADO" { $headers.ejecutado = $col }
        "PENDIENTE POR CERTIFICAR" { $headers.pendienteCertificar = $col }
        "PENDIENTE POR DEVENGAR" { $headers.pendienteDevengar = $col }
        "PENDIENTE POR EJECUTAR" { $headers.pendienteEjecutar = $col }
      }
    }

    if (
      $headers.Contains("partida") -and
      $headers.Contains("initial") -and
      $headers.Contains("reforma") -and
      $headers.Contains("codificado") -and
      $headers.Contains("certificado")
    ) {
      $headers.row = $row
      return $headers
    }
  }

  throw "No se encontro la fila de encabezados esperada."
}

function Update-PayloadFromRecords {
  param(
    [hashtable]$RecordsByLeaf,
    [string]$PayloadPath
  )

  $payload = Get-Content -LiteralPath $PayloadPath -Raw | ConvertFrom-Json
  $itemsByCode = @{}
  foreach ($item in $payload.items) {
    $itemsByCode[$item.code] = $item
  }

  $totalsByDirection = @{}
  foreach ($record in $RecordsByLeaf.Values) {
    $directionCode = $record.DirectionCode
    if (-not $itemsByCode.ContainsKey($directionCode)) {
      continue
    }

    if (-not $totalsByDirection.ContainsKey($directionCode)) {
      $totalsByDirection[$directionCode] = [ordered]@{
        Initial = [decimal]::Zero
        Reforma = [decimal]::Zero
        Codificado = [decimal]::Zero
        Certificado = [decimal]::Zero
        Comprometido = [decimal]::Zero
        Devengado = [decimal]::Zero
        Ejecutado = [decimal]::Zero
        PendienteCertificar = [decimal]::Zero
        PendienteDevengar = [decimal]::Zero
        PendienteEjecutar = [decimal]::Zero
      }
    }

    $totalsByDirection[$directionCode].Initial += $record.Initial
    $totalsByDirection[$directionCode].Reforma += $record.Reforma
    $totalsByDirection[$directionCode].Codificado += $record.Codificado
    $totalsByDirection[$directionCode].Certificado += $record.Certificado
    $totalsByDirection[$directionCode].Comprometido += $record.Comprometido
    $totalsByDirection[$directionCode].Devengado += $record.Devengado
    $totalsByDirection[$directionCode].Ejecutado += $record.Ejecutado
    $totalsByDirection[$directionCode].PendienteCertificar += $record.PendienteCertificar
    $totalsByDirection[$directionCode].PendienteDevengar += $record.PendienteDevengar
    $totalsByDirection[$directionCode].PendienteEjecutar += $record.PendienteEjecutar
  }

  $changed = $false
  foreach ($entry in $totalsByDirection.GetEnumerator()) {
    $item = $itemsByCode[$entry.Key]
    $nextInitial = [double]([math]::Round($entry.Value.Initial, 2))
    $nextReforma = [double]([math]::Round($entry.Value.Reforma, 2))
    $nextCodificado = [double]([math]::Round($entry.Value.Codificado, 2))
    $nextCertificado = [double]([math]::Round($entry.Value.Certificado, 2))
    $nextComprometido = [double]([math]::Round($entry.Value.Comprometido, 2))
    $nextDevengado = [double]([math]::Round($entry.Value.Devengado, 2))
    $nextEjecutado = [double]([math]::Round($entry.Value.Ejecutado, 2))
    $nextPendienteCertificar = [double]([math]::Round($entry.Value.PendienteCertificar, 2))
    $nextPendienteDevengar = [double]([math]::Round($entry.Value.PendienteDevengar, 2))
    $nextPendienteEjecutar = [double]([math]::Round($entry.Value.PendienteEjecutar, 2))
    $currentCertificado = if ($null -ne $item.PSObject.Properties["certificado"]) { [double]$item.certificado } else { 0 }
    $currentComprometido = if ($null -ne $item.PSObject.Properties["comprometido"]) { [double]$item.comprometido } else { 0 }
    $currentDevengado = if ($null -ne $item.PSObject.Properties["devengado"]) { [double]$item.devengado } else { 0 }
    $currentEjecutado = if ($null -ne $item.PSObject.Properties["ejecutado"]) { [double]$item.ejecutado } else { 0 }
    $currentPendienteCertificar = if ($null -ne $item.PSObject.Properties["pendienteCertificar"]) { [double]$item.pendienteCertificar } else { 0 }
    $currentPendienteDevengar = if ($null -ne $item.PSObject.Properties["pendienteDevengar"]) { [double]$item.pendienteDevengar } else { 0 }
    $currentPendienteEjecutar = if ($null -ne $item.PSObject.Properties["pendienteEjecutar"]) { [double]$item.pendienteEjecutar } else { 0 }

    if (
      ($item.initial -ne $nextInitial) -or
      ($item.reforma -ne $nextReforma) -or
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

    $item.initial = $nextInitial
    $item.reforma = $nextReforma
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
    LeafRowsUsed = $RecordsByLeaf.Count
    Changed = $changed
  }
}

$resolvedSourceDir = Resolve-Path -LiteralPath $SourceDir
$resolvedSyncSourcePath = Resolve-Path -LiteralPath $SyncSourcePath
$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$sourceFiles = @(Get-ChildItem -LiteralPath $resolvedSourceDir -File | Where-Object { $_.Name -like $Pattern } | Sort-Object LastWriteTime -Descending)

if ($sourceFiles.Count -eq 0) {
  throw "No se encontraron archivos con el patron '$Pattern' en '$resolvedSourceDir'."
}

$recordsByLeaf = @{}

$pythonPath = Resolve-PythonPath
$parserPath = Join-Path $PSScriptRoot "parse-financiero-exports.py"
$fileArgs = @($sourceFiles | ForEach-Object { $_.FullName })
$records = & $pythonPath $parserPath @fileArgs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "Fallo parse-financiero-exports.py."
}

foreach ($record in $records) {
  if (
    (-not $recordsByLeaf.ContainsKey($record.Partida)) -or
    ([DateTime]$record.FileTime -gt [DateTime]$recordsByLeaf[$record.Partida].FileTime)
  ) {
    $recordsByLeaf[$record.Partida] = $record
  }
}

$update = Update-PayloadFromRecords -RecordsByLeaf $recordsByLeaf -PayloadPath $resolvedSyncSourcePath

$result = [ordered]@{
  sourceDir = [string]$resolvedSourceDir
  matchedFiles = $sourceFiles.Count
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
    git -c core.safecrlf=false add data/sync-source/latest.json data/budget-viewer-data.json public/budget-viewer-data.js public/budget-viewer-data.json public/sync-source/latest.json
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit -m "chore: sync financiero exports"
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
