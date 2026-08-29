param(
  [ValidateSet('snapshot', 'toggle', 'play', 'pause', 'next', 'previous', 'seek', 'openSource')]
  [string]$Action = 'snapshot',
  [double]$PositionSec = 0,
  [string]$SourceAppId = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await-Operation($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

function Await-Action($Operation) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$manager = $null
try {
  $manager = Await-Operation ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
  if ($Action -eq 'snapshot') { @{ active = $false; updatedAt = 0 } | ConvertTo-Json -Compress }
  exit 0
}
$session = $manager.GetCurrentSession()

if ($Action -eq 'openSource') {
  if ($SourceAppId) { Start-Process "shell:AppsFolder\$SourceAppId" -ErrorAction SilentlyContinue }
  exit 0
}

if (-not $session) {
  if ($Action -eq 'snapshot') { @{ active = $false; updatedAt = 0 } | ConvertTo-Json -Compress }
  exit 0
}

if ($Action -ne 'snapshot') {
  switch ($Action) {
    'toggle'   { Await-Operation ($session.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
    'play'     { Await-Operation ($session.TryPlayAsync()) ([bool]) | Out-Null }
    'pause'    { Await-Operation ($session.TryPauseAsync()) ([bool]) | Out-Null }
    'next'     { Await-Operation ($session.TrySkipNextAsync()) ([bool]) | Out-Null }
    'previous' { Await-Operation ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null }
    'seek'     { Await-Operation ($session.TryChangePlaybackPositionAsync([long]([Math]::Max(0, $PositionSec) * 10000000))) ([bool]) | Out-Null }
  }
  exit 0
}

$properties = Await-Operation ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$playback = $session.GetPlaybackInfo()
$timeline = $session.GetTimelineProperties()
$controls = $playback.Controls
$artworkDataUrl = ''

try {
  if ($properties.Thumbnail) {
    $stream = Await-Operation ($properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($stream.Size -gt 0 -and $stream.Size -le 6291456) {
      $reader = New-Object Windows.Storage.Streams.DataReader($stream)
      Await-Operation ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
      $bytes = New-Object byte[] ([int]$stream.Size)
      $reader.ReadBytes($bytes)
      $mime = if ($stream.ContentType) { $stream.ContentType } else { 'image/jpeg' }
      $artworkDataUrl = "data:$mime;base64,$([Convert]::ToBase64String($bytes))"
      $reader.Dispose()
      $stream.Dispose()
    }
  }
} catch {}

$sourceId = $session.SourceAppUserModelId
$sourceName = if ($sourceId) { ($sourceId -split '!')[0] } else { 'Windows Media' }
$state = [ordered]@{
  active = $true
  playing = $playback.PlaybackStatus.ToString() -eq 'Playing'
  title = [string]$properties.Title
  artist = [string]$properties.Artist
  album = [string]$properties.AlbumTitle
  appBundleId = [string]$sourceId
  appName = [string]$sourceName
  durationSec = [Math]::Max(0, $timeline.EndTime.TotalSeconds - $timeline.StartTime.TotalSeconds)
  elapsedSec = [Math]::Max(0, $timeline.Position.TotalSeconds - $timeline.StartTime.TotalSeconds)
  playbackRate = if ($playback.PlaybackRate) { [double]$playback.PlaybackRate } else { 0 }
  artworkDataUrl = $artworkDataUrl
  canPlayPause = [bool]($controls.IsPlayEnabled -or $controls.IsPauseEnabled)
  canNext = [bool]$controls.IsNextEnabled
  canPrevious = [bool]$controls.IsPreviousEnabled
  updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
$state | ConvertTo-Json -Compress
