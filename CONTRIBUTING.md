# Contributing

Thank you for helping improve Orca.

## Local setup

Orca requires macOS and Node.js 22 or newer. Use the isolated mode for
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

## Architecture

`src/main/index.cjs` is the composition root. Put policy and platform behavior
in focused modules with injected dependencies, and keep renderer bridges narrow.
See `docs/ARCHITECTURE.md` for the runtime boundaries.

## Security

Do not include tokens, local Agent transcripts, `.local-*` directories, private
hooks, or proprietary assets. Report vulnerabilities according to
`SECURITY.md` rather than in a public issue.
