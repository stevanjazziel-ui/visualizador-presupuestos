[CmdletBinding()]
param(
  [string]$DirectSourcePath = "",
  [int]$PollSeconds = 10,
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

if ([string]::IsNullOrWhiteSpace($DirectSourcePath)) {
  $DirectSourcePath = Join-Path $PSScriptRoot "..\data\sync-source\financiero-direct-scrape.json"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resolvedDirectSourcePath = Resolve-Path -LiteralPath $DirectSourcePath
$baselineStamp = (Get-Item -LiteralPath $resolvedDirectSourcePath).LastWriteTimeUtc.Ticks

Write-Output "Esperando cambios en la fuente directa $resolvedDirectSourcePath"

while ($true) {
  Start-Sleep -Seconds $PollSeconds
  $latest = Get-Item -LiteralPath $resolvedDirectSourcePath
  if ($latest.LastWriteTimeUtc.Ticks -le $baselineStamp) {
    continue
  }

  Write-Output "Cambio detectado en $($latest.Name)"
  Push-Location $repoRoot
  try {
    if ($Publish) {
      & ".\scripts\import-financiero-direct.ps1" -DirectSourcePath $resolvedDirectSourcePath -Publish
    } else {
      & ".\scripts\import-financiero-direct.ps1" -DirectSourcePath $resolvedDirectSourcePath
    }

    if ($LASTEXITCODE -ne 0) {
      throw "La importacion directa devolvio codigo $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  break
}
