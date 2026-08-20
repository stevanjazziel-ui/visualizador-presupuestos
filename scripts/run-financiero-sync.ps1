[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [string]$LogDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
  $ProjectRoot = Resolve-Path $ProjectRoot
}

if ([string]::IsNullOrWhiteSpace($LogDir)) {
  $LogDir = Join-Path $ProjectRoot "logs"
}

$null = New-Item -ItemType Directory -Force -Path $LogDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $LogDir "financiero-sync-$timestamp.log"

function Write-Log {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Output $line
}

try {
  Write-Log "Inicio de sincronizacion financiera."
  Push-Location $ProjectRoot
  try {
    & ".\scripts\import-financiero-exports.ps1" -Publish 2>&1 |
      ForEach-Object {
        Add-Content -LiteralPath $logPath -Value $_ -Encoding UTF8
        Write-Output $_
      }
    if ($LASTEXITCODE -ne 0) {
      throw "La importacion financiera devolvio codigo $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
  Write-Log "Sincronizacion completada correctamente."
} catch {
  Write-Log ("Fallo la sincronizacion: " + $_.Exception.Message)
  throw
}
