param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$ApplicationLogs,
  [Parameter(Mandatory = $true)][string]$HookLogs
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("workisland-logs-" + [guid]::NewGuid().ToString("N"))
$archive = Join-Path $OutputDirectory ("workisland-diagnostics-$timestamp.zip")

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
try {
  if (Test-Path -LiteralPath $ApplicationLogs) {
    Copy-Item -LiteralPath $ApplicationLogs -Destination (Join-Path $workDirectory "application-logs") -Recurse
  }
  if (Test-Path -LiteralPath $HookLogs) {
    Copy-Item -LiteralPath $HookLogs -Destination (Join-Path $workDirectory "hook-logs") -Recurse
  }
  Compress-Archive -LiteralPath $workDirectory -DestinationPath $archive -Force
  Write-Output "OUTPUT_FILE:$archive"
} finally {
  Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
