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
      }
    }

    if (
      $headers.Contains("partida") -and
      $headers.Contains("initial") -and
      $headers.Contains("reforma") -and
      $headers.Contains("codificado")
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
      }
    }

    $totalsByDirection[$directionCode].Initial += $record.Initial
    $totalsByDirection[$directionCode].Reforma += $record.Reforma
    $totalsByDirection[$directionCode].Codificado += $record.Codificado
  }

  $changed = $false
  foreach ($entry in $totalsByDirection.GetEnumerator()) {
    $item = $itemsByCode[$entry.Key]
    $nextInitial = [double]([math]::Round($entry.Value.Initial, 2))
    $nextReforma = [double]([math]::Round($entry.Value.Reforma, 2))
    $nextCodificado = [double]([math]::Round($entry.Value.Codificado, 2))

    if (
      ($item.initial -ne $nextInitial) -or
      ($item.reforma -ne $nextReforma) -or
      ($item.codificado -ne $nextCodificado)
    ) {
      $changed = $true
    }

    $item.initial = $nextInitial
    $item.reforma = $nextReforma
    $item.codificado = $nextCodificado
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

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

$recordsByLeaf = @{}

try {
  foreach ($file in $sourceFiles) {
    $workbook = $excel.Workbooks.Open($file.FullName)
    try {
      $worksheet = $workbook.Worksheets.Item(1)
      $headerMap = Find-HeaderMap -Worksheet $worksheet
      $usedRows = $worksheet.UsedRange.Rows.Count

      for ($row = ($headerMap.row + 1); $row -le $usedRows; $row++) {
        $partida = ([string]$worksheet.Cells.Item($row, $headerMap.partida).Text).Trim()
        if ($partida -notmatch '^\d+(?:\.\d+){8,}$') {
          continue
        }

        if ($partida -notmatch '(\d{4}\.\d+\.\d+)') {
          continue
        }

        $directionCode = $Matches[1]
        $record = [pscustomobject]@{
          File = $file.Name
          FileTime = $file.LastWriteTimeUtc
          Partida = $partida
          DirectionCode = $directionCode
          Initial = Convert-ToDecimal ([string]$worksheet.Cells.Item($row, $headerMap.initial).Text)
          Reforma = Convert-ToDecimal ([string]$worksheet.Cells.Item($row, $headerMap.reforma).Text)
          Codificado = Convert-ToDecimal ([string]$worksheet.Cells.Item($row, $headerMap.codificado).Text)
        }

        if (
          (-not $recordsByLeaf.ContainsKey($partida)) -or
          ($record.FileTime -gt $recordsByLeaf[$partida].FileTime)
        ) {
          $recordsByLeaf[$partida] = $record
        }
      }
    }
    finally {
      $workbook.Close($false)
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet) | Out-Null
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
    }
  }
}
finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
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
