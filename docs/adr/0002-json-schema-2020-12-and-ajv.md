# 0002. JSON Schema draft 2020-12, validated with Ajv in strict mode

- **Status:** Accepted (revised after the PR #1 review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01, SR-SPEC-04

## Context

The spec needs a machine-readable, widely supported schema language. A
conformance suite also needs one reference validator, so that "valid" has
exactly one meaning.

## Decision

- JSON Schema **draft 2020-12** is the normative format. Every schema declares
  `"$schema": "https://json-schema.org/draft/2020-12/schema"`.
- The reference validator is **Ajv 8 (`Ajv2020`) with `ajv-formats`**. It runs
  with `strict: true` and `allErrors: true`, and the versions are pinned
  exactly in `package.json`.
- `strictRequired` is turned **off**. Conditional `then: {required: [...]}`
  blocks name properties that the parent schema declares, and strict mode
  reports these as unknown even though they are correct. All other strict
  checks stay on, including `strictTypes`. Conditional subschemas therefore
  carry an explicit `"type": "object"` where Ajv needs one.
- Ajv is *a* reference, not *the* definition. Conformance locators use the
  standard output-format vocabulary (ADR-0006), and a second validator
  (python-jsonschema) runs the suite in CI.
- Format assertion is **required**.

## Consequences

- Strict mode catches typos such as unknown keywords and ignored constraints when the schemas are compiled.
- Other validators can run the suite without adapting to Ajv's error shape.
- Formats (`uri`, `uuid`, `regex`, `hostname`) are asserted, not just annotated.

## Alternatives considered

- **Draft-07.** It has wider legacy support, but no `$defs` and weaker `$ref` semantics.
- **TypeSpec/CUE as the source language.** This adds a build step and a second source of truth.
