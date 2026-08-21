[CmdletBinding()]
param(
  [string]$SourceDir = "$env:USERPROFILE\Downloads",
  [string]$Pattern = "Partida XLS-*.xls",
  [int]$PollSeconds = 5,
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resolvedSourceDir = Resolve-Path -LiteralPath $SourceDir

function Get-LatestExport {
  param(
    [string]$Dir,
    [string]$Filter
  )

  return Get-ChildItem -LiteralPath $Dir -File |
    Where-Object { $_.Name -like $Filter } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
}

$baseline = Get-LatestExport -Dir $resolvedSourceDir -Filter $Pattern
$baselineStamp = if ($baseline) { $baseline.LastWriteTimeUtc.Ticks } else { 0 }

Write-Output "Esperando nuevo exporte de Financiero en $resolvedSourceDir"

while ($true) {
  Start-Sleep -Seconds $PollSeconds
  $latest = Get-LatestExport -Dir $resolvedSourceDir -Filter $Pattern
  if (-not $latest) {
    continue
  }

  if ($latest.LastWriteTimeUtc.Ticks -le $baselineStamp) {
    continue
  }

  Write-Output "Nuevo archivo detectado: $($latest.Name)"
  Push-Location $repoRoot
  try {
    if ($Publish) {
      & ".\scripts\import-financiero-exports.ps1" -SourceDir $resolvedSourceDir -Pattern $Pattern -Publish
    } else {
      & ".\scripts\import-financiero-exports.ps1" -SourceDir $resolvedSourceDir -Pattern $Pattern
    }

    if ($LASTEXITCODE -ne 0) {
      throw "La importacion devolvio codigo $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  break
}
