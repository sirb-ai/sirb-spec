# 0009. Versioning and migrations

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-05

## Context

SR-SPEC-05: "Versioned with semver; breaking changes need new apiVersion +
migration". The first PR only said that "v1beta1 gets its own directory". It
did not say how package semver relates to `apiVersion`, what counts as a
breaking change, or how migrations are delivered.

## Decision

The full policy is in `VERSIONING.md`. In summary:
- `apiVersion` (for example `sirb/v1alpha1`) versions the document format.
  Package semver versions the package. There is one `schema/<version>/`
  directory per apiVersion.
- Alpha directories can change in place, with the change recorded in the
  CHANGELOG. Beta and GA directories are **frozen**:
  - `npm run freeze` records file hashes in `schema/frozen.json`.
  - `test/versioning.test.mjs` fails if a frozen file changes, is removed, or
    gets a new sibling file.
- Breaking means that a previously valid document becomes invalid, or changes
  meaning. A breaking change ships as a new apiVersion plus a
  `migrations/<from>-to-<to>.mjs` file for every frozen predecessor. The test
  enforces that these migrations exist.
- The package stays at `0.x` while only alpha apiVersions exist. Every release
  needs a CHANGELOG section, and a test checks for it.

## Consequences

- Consumers can pin an apiVersion and rely on it once it reaches beta.
- Tightening a frozen schema for security reasons cannot be done by editing
  the schema. It goes through the loader's secret scan instead (patch release).

## Alternatives considered

- **Package major version = apiVersion.** This mixes up loader API changes and document format changes.
- **Policing in review only.** That is not enforceable, and append-only rules are easy to break by accident.
