# 0007. CI supply-chain hardening

- **Status:** Accepted (revised after the PR #1 review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-05

## Context

The spec repo is a dependency of every Sirb component. A compromised GitHub
Action or npm package in its CI could tamper with the published schemas.

## Decision

- `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It has three jobs:
  - `npm ci --ignore-scripts && npm test` on Node 22 and 24
  - the Python second-validator conformance runner. Its dependencies are installed with `--require-hashes --no-deps --only-binary=:all:`.
  - gitleaks over the full git history. The release tarball is checked against a pinned sha256 before it runs. A canary step then plants a real-looking token in a fixture and fails unless gitleaks reports it. This step exists because an earlier allowlist was silently ignored by gitleaks 8.24.0 (`[[allowlists]]` with `[extend]`), and the single-table form ignores `condition = "AND"`. So the allowlist now matches on the finding's text only.
- Superseded runs are cancelled for pull requests only. Every `main` build finishes.
- **Every third-party action is pinned by its full 40-character commit SHA**,
  with a `# vX.Y.Z` comment. Dependabot (already configured for
  `github-actions`) proposes updates.
  `test/workflows.test.mjs` parses the workflow and checks the following:
  - every `uses:` is pinned to a SHA and has a version comment
  - top-level permissions are exactly `{contents: read}`
  - no job declares its own `permissions`
  - `pull_request_target` is not used
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
