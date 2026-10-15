# 0006. Conformance fixture format

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-04

## Context

Alternative implementations (editors, operators, other languages) need an
executable definition of what "valid" means. An invalid fixture that only says
`valid: false` can pass for the wrong reason.

## Decision

- Each fixture is one JSON file at
  `conformance/fixtures/<kind>/(valid|invalid)-<slug>.json`. Its shape is
  defined by `conformance/fixture.schema.json`. JSON was chosen so that no YAML
  dependency is needed and every language can read it.
- The fields are `description`, `requirements` (SR IDs), `level`, `expect`
  and `document`.
- Invalid fixtures must carry **error locators**: `instancePath` + `keyword`,
  with optional `params` matched as a subset. Each locator must match at least
  one reported error. Extra errors are tolerated, because wrapper errors from
  `if`/`oneOf` vary between validators.
- Each document is validated against its kind schema **and** against
  `resource.schema.json`, and both must give the same result.
- `level: "semantic"` is reserved for rules that JSON Schema cannot express:
  step DAG validity and uniqueness, resolution of cross-resource references,
  fallback cycles, and `overlap < size`. In v1alpha1, `level` must be `"schema"`.

## Consequences

- A fixture fails if a schema regression changes *why* a document is rejected,
  not only *whether* it is rejected.
- Keyword names follow Ajv (ADR-0002). Other validators may need a small mapping.

## Alternatives considered

- **The JSON-Schema-Test-Suite format** (many cases per file, no locators).
  Too coarse for a spec contract.
- **Snapshotting the full error list.** Too brittle across validator versions.
