# WorkIsland Documentation

This directory is the GitHub-reviewable source for active product, engineering, release, and privacy documentation. A contributor must be able to understand why a change exists, how it is validated, and how it will be released without relying on private chat history or a local folder.

## Start Here

- [Product Operating System](./PRODUCT_OPERATING_SYSTEM.md): the path from product decision to release, repository roles, and GitHub settings.
- [Product Documentation](./product/README.md): vision, roadmap, active PRDs, Epics, and reusable templates.
- [Release Process](./RELEASE_PROCESS.md): package, signing, tag, GitHub Release, and update-channel rules.
- [Telemetry](./TELEMETRY.md): anonymous telemetry data contract and PostHog operational guide.

## Documentation Rules

1. A new user-facing or cross-module capability starts with an Epic or Feature PRD in `docs/product/` before it is split into GitHub Issues.
2. Each external Beta or stable release has one version PRD and one 24-hour / 7-day review record.
3. A code change that changes user behavior, privacy, architecture, or release operation updates its linked documentation in the same pull request.
4. Local notes can support discovery, but they are not an approval record until their relevant decision is moved here and reviewed in GitHub.
