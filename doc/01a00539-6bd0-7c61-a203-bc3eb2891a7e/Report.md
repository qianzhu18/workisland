# WorkIsland 0.2.8-beta.8 Report

## Outcome

The cumulative bug-fix set is implemented on `release/v0.2.8-beta.8`. It includes all
previously requested icon, feedback, community, runtime, test, and documentation work,
plus the latest author WeChat QR update.

## Delivery

- Feature commit: `3e3a9009650beb7cfb7b7a6ac4f9673d89c37047`
- Remote branch: `origin/release/v0.2.8-beta.8`
- Remote verification: the branch reference resolved to the feature commit after push.
- No release tag was created; tagging remains the explicit trigger for the signed and
  notarized public GitHub Release workflow.

## Changes

- Settings now uses the WorkIsland product icon in the sidebar and About view.
- The Island Codex quota marker uses the supplied transparent Codex artwork instead of
  the `C` placeholder.
- All 16 core Agents and 2 plugin Agents map to local image assets. TRAE-family
  connectors intentionally share TRAE artwork; Aiden uses a documented generic Agent
  fallback because no verifiable public Aiden logo was found.
- Settings About provides direct email feedback to `its.qianzhu@gmail.com`, a GitHub
  feedback entry, and a stable website link for WeChat contact and the beta group.
- The external URL policy only permits mail to the exact feedback recipient and rejects
  alternate recipients, CC injection, unsupported fields, and CR/LF injection.
- The website shows email/GitHub feedback, the WorkIsland beta-group QR code, and the
  Qianzhu author-contact QR code. Both QR images are local website assets and are not
  bundled into the desktop application.
- Isolated development now derives a short, deterministic, worktree-specific Unix socket
  path. Production socket behavior is unchanged.
- Version metadata was advanced from `0.2.8-beta.7` to `0.2.8-beta.8`.

## Asset provenance

Agent assets were researched through the requested `a2w-skill` route. Native web search
returned a server error, so the documented fallback used official repositories, the npm
registry, and direct upstream files. Runtime assets are local and do not make remote image
requests. See `docs/AGENT_BRAND_ASSETS.md` and `THIRD_PARTY_NOTICES.md`.

## Verification

- `npm run check`: passed, including static checks, source contracts, and 41/41 unit tests.
- `npm run build:native`: passed without compiler warnings.
- Isolated Electron startup: passed; BridgeServer listened on the short hashed socket and
  no longer emitted `EINVAL`.
- Hook smoke test: passed.
- Codex approval smoke test: passed.
- UI smoke test: passed for Island, 18 Agent icons, support channels, pet, and pet panel.
- Website browser QA: passed at 375, 768, and 1280 px; two QR images loaded, no horizontal
  overflow, and no console errors.
- `npm run release:check -- --tag v0.2.8-beta.8`: passed.
- DMG verification: passed with `hdiutil verify`.
- DMG SHA-256: `1e431757a7114b5be8c4094b7d37478368c345d645f7b2fcdcb99c27db7ce03f`.
- Artifact: `release/WorkIsland-0.2.8-beta.8-arm64.dmg` (128 MB).
- Packaged ASAR: contains all brand assets and `THIRD_PARTY_NOTICES.md`.

## Compatibility review

No breaking change was introduced. Existing Agent IDs, Hook configuration formats, IPC
contracts, production socket location, website anchors, and GitHub feedback URL remain
valid. The new mail protocol is additive and restricted to the configured author address.
Therefore no separate breaking-change document is required.

## Code and test review

- New code follows the existing JavaScript/CommonJS/ESM conventions.
- English comments are present only where reconstruction or behavior is non-obvious.
- All new automated tests live under `tests/`; production logic contains no test blocks.
- This repository is not a Rust project: no `Cargo.toml`, `.rs`, `#[cfg(test)]`,
  `dead_code`, or Rust compiler warnings exist, so the Rust-specific requirements are not
  applicable.

## Release note

The local artifact is ad-hoc signed because this machine has no Developer ID identity.
The repository release workflow remains responsible for Developer ID signing, Apple
notarization, stapling, and public GitHub Release upload.
