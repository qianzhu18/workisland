# Task 01a00539-6bd0-7c61-a203-bc3eb2891a7e

- Status: implementation and verification complete
- Target release: `0.2.8-beta.8`
- Delivery branch: `release/v0.2.8-beta.8`
- Feature commit: `3e3a9009650beb7cfb7b7a6ac4f9673d89c37047`
- Remote status: pushed to `origin/release/v0.2.8-beta.8`
- Release tag: `v0.2.8-beta.8` will point to the final report commit and trigger the
  signed, notarized GitHub Release workflow.
- Updated: 2026-08-15

## Scope

1. Replace WorkIsland and Codex letter placeholders with the supplied product artwork.
2. Replace every Settings Agent letter badge with a local brand asset found through the
   `a2w-skill` research route.
3. Add direct email feedback, GitHub feedback, WeChat beta-group, and author contact
   paths to Settings and the website.
4. Publish both the WorkIsland beta-group QR code and Qianzhu author-contact QR code on
   the website.
5. Fix isolated development startup for repositories whose paths exceed the macOS Unix
   socket path limit.
6. Compile, test, inspect breaking-change risk, produce release documentation, and build
   the next prerelease artifact.

No `Todo.md` is required because the requested implementation is complete. Release
signing and notarization remain CI responsibilities, not unfinished product work.
