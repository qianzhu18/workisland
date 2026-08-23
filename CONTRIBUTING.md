# Contributing

Thank you for helping improve WorkIsland.

## Local setup

WorkIsland requires Apple Silicon macOS or Windows 11 x64 and Node.js 22 or newer. Use the isolated mode for
routine development so Agent configuration in your real home directory is not
modified.

```bash
npm ci
npm run doctor
npm run check
npm run dev:isolated
```

Before opening a pull request, run `npm run check`. Keep changes focused, add a
contract test for behavior changes, and update the relevant documentation.

## Product and GitHub workflow

Read the [Product Operating System](./docs/PRODUCT_OPERATING_SYSTEM.md) before
starting a user-facing feature. New capabilities begin with an Epic or Feature
PRD, then become small GitHub Issues; bugs and scoped implementation tasks can
start as an Issue. Every PR must link its Issue, state its user outcome, record
verification, and update documentation that it changes.

Branch from current `main` using `feature/<topic>`, `fix/<topic>`, or
`docs/<topic>`. Do not push directly to `main`. Use the repository's Issue and
Pull Request templates so another maintainer can review the decision without
private chat context.

## Architecture

`src/main/index.cjs` is the composition root. Put policy and platform behavior
in focused modules with injected dependencies, and keep renderer bridges narrow.
See `docs/ARCHITECTURE.md` for the runtime boundaries.

## Security

Do not include tokens, local Agent transcripts, `.local-*` directories, private
hooks, or proprietary assets. Report vulnerabilities according to
`SECURITY.md` rather than in a public issue.
