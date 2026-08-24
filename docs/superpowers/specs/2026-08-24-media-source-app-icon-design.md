# Media Source App Icon Design

## Goal

Replace the text source badge on album artwork with the actual icon of the local macOS application that owns the current media session.

## Reference behavior

Atoll resolves the application from the media session bundle identifier, asks macOS for the installed application's icon, and overlays that icon on the album artwork. WorkIsland will reproduce the behavior through its own Electron architecture rather than copying Atoll source.

## Architecture

- The MediaRemote Adapter remains responsible for playback metadata and supplies `bundleIdentifier`.
- A focused main-process resolver finds the installed `.app` with Spotlight metadata and asks Electron for its native icon.
- Resolved icons are converted to bounded PNG data URLs and cached by bundle identifier.
- `MediaService` enriches normalized media snapshots asynchronously. It publishes metadata immediately, then republishes the same track with `appIconDataUrl` after resolution.
- The renderer displays the icon as a 32 px overlay at the artwork's lower-right corner. Source-name text is removed.

## Safety and fallback

- Bundle identifiers are accepted only when they match the macOS-style character allowlist and length bound.
- Process execution uses argument arrays, never a shell.
- Resolver output must be an existing `.app` path. Results outside application bundles are rejected.
- Icon data is accepted only as a bounded `data:image/png;base64,...` URL.
- Failed resolution is cached for the current process and omits the overlay; the app name is never restored as text.
- No icon or media metadata leaves the machine.

## Visual behavior

- The source icon is 32 x 32 px, placed at the artwork's lower-right corner with a 1 px translucent border and soft shadow.
- A source change uses a short scale-and-fade entrance. It does not loop.
- Reduced-motion mode disables the entrance animation.
- The icon remains inside the artwork button, so clicking it retains the existing “open media application” behavior.

## Tests

- Resolver tests cover valid lookup, invalid bundle identifiers, non-app output, cache reuse, and lookup failure.
- Media state tests cover icon-data validation and normalization.
- Media service tests prove immediate metadata publication followed by icon enrichment without leaking a stale icon into a new source.
- Renderer source tests prove the text badge is gone and the image/fallback badge is present.
