# Fixed quota restoration and v1.6.0 release

Goal: Restore the original fixed left Codex 5h/7d usage presentation, keep the usage dashboard independently stowable, verify system switches, then publish official macOS packages.

- [x] Trace the question-mark icon to an unshipped SVG reference in the unmerged preview PR #194. Keep #194 out of this release and build from main.
- [x] Restore fixed Codex cells and existing bundled PNG; retain original period/used-percentage/reset countdown, add a letter fallback for asset errors, wire through the existing display switch.
- [x] Default new installations to storing the independent usage dashboard in More; preserve explicit saved toolbar preferences.
- [x] Verify all six native system capabilities can be independently disabled and reenabled; lock-screen display stays off by default.
- [x] Run source checks and real packaged UI checks: loaded image, fixed quota text, dashboard store/pin, six settings switches and persistence, real capture enable/disable, Agent event.
- [x] Merge the focused restoration PR after CI; restore and update the paused v1.6.0 release preparation.
- [ ] Build candidate from the exact release head; tag only after local acceptance and CI; verify arm64/x64 signing, notarization, SHA-256 and stable update metadata.
- [ ] Publish bilingual notes, merge release documentation after the tag exists, verify website and update discovery, and install the final official package locally with rollback preserved.

No test screenshots or account usage totals are published to the PR. Physical headset/network/lock scenarios that have not been exercised remain stated limitations; unit/layout tests do not substitute for them.
