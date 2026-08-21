[CmdletBinding()]
param(
  [string]$OutputPath = "",
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

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

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodePath = Resolve-NodePath
$scriptPath = Join-Path $PSScriptRoot "scrape-financiero-direct.mjs"
$argsList = @($scriptPath)

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $argsList += @("--output", $OutputPath)
}

if ($Publish) {
  $argsList += "--publish"
}

& $nodePath @argsList
if ($LASTEXITCODE -ne 0) {
  throw "El scraper directo devolvio codigo $LASTEXITCODE."
}
