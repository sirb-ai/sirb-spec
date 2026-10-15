# 0007. CI supply-chain hardening

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-05

## Context

The spec repo is a dependency of every Sirb component. A compromised GitHub
Action or npm package in its CI could tamper with the published schemas.

## Decision

- `.github/workflows/ci.yml` runs `npm ci --ignore-scripts && npm test` on
  Node 22 and 24, for pushes to `main` and for pull requests.
- **Every third-party action is pinned by its full 40-character commit SHA**,
  with a `# vX.Y.Z` comment. Dependabot (already configured for
  `github-actions`) proposes updates.
  `test/workflows.test.mjs` fails on any `uses:` that is not pinned to a SHA.
- `permissions: contents: read` is set at the workflow level, and
  `actions/checkout` runs with `persist-credentials: false`.
- npm dependencies are pinned to exact versions, `package-lock.json` is
  committed, and install scripts are disabled in CI.

## Consequences

- Moving a tag upstream cannot change what CI runs.
- Version bumps arrive as Dependabot PRs that need review.

## Alternatives considered

- **Pinning by major tag (`@v7`).** Tags can be moved.
- **Vendoring actions.** Too much upkeep for two actions.
