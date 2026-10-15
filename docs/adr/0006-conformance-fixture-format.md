# 0006. Conformance fixture format

- **Status:** Accepted (revised after the PR #1 review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01 … SR-SPEC-04

## Context

The spec has two runtimes, Node.js and .NET, as well as editors and other
tools. Each of them needs an executable definition of what "valid" means.

The first version of the format used Ajv's error vocabulary: `params`,
`"false schema"`, and Ajv's paths for `propertyNames` errors. A second
validator could not use those locators as written.

## Decision

- Each fixture is one JSON file, and `conformance/fixture.schema.json` defines
  its shape. There are two levels:
  - **`schema`** holds a parsed `document`.
  - **`loader`** holds raw `source` text and a `format` (`yaml` or `json`).
    These fixtures cover parsing (SR-SPEC-03) and the literal-secret scan
    (SR-SPEC-04).
- **Locators follow the JSON Schema standard output format.** Each one has an
  `instancePath` (the standard `instanceLocation`) and a standard `keyword`.
  A false subschema uses `"false"`. A `propertyNames` failure is reported at
  the object, with the inner keyword. `property` is informative only. Loader
  locators carry a `code`, plus `document` for streams.
- A locator matches when at least one reported error matches it. Extra errors are tolerated.
- **Format assertion is required.** Some fixtures fail only on `format`.
- **There are two reference runners.** The Node.js runner (Ajv) runs every
  fixture. The Python runner (`jsonschema`) runs the schema level. CI runs
  both, so any wording that depends on a single validator shows up as a
  failure. The Python runner documents one validator quirk it works around
  (the path of `false`-schema errors).
- The reference runner also checks two other things:
  - `resource.schema.json` gives the same verdict as the kind schema.
  - The loader gives the same verdict on a JSON encoding and a YAML encoding of
    every schema fixture.
- `level: semantic` is reserved for rules that JSON Schema cannot express.

## Consequences

- The .NET runtime can implement a runner using only the standard output format.
- When the .NET repository exists, it should add a JsonSchema.Net runner as a
  third CI job.

## Alternatives considered

- **Ajv-specific locators with a mapping table.** Every new validator would
  need its own adapter.
- **Full error snapshots.** These are brittle across validator versions.
