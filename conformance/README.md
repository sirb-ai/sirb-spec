# Sirb Agent Spec conformance suite

This suite pins down how the `sirb/v1alpha1` schemas behave. Each fixture is a
Sirb document together with the result a conforming validator must give for it.
Any implementation (a CLI, an operator or an editor plugin) can run the suite.

The reference runner is `test/conformance.test.mjs`. Run it with `npm test`.

## Fixture format

A fixture is one JSON file. Its own shape is defined by
[`fixture.schema.json`](fixture.schema.json), and the runner rejects fixtures
that don't match it.

```json
{
  "description": "billable bindings must not carry customer credentials",
  "requirements": ["SR-SPEC-02"],
  "level": "schema",
  "expect": {
    "valid": false,
    "errors": [{ "instancePath": "/spec/credentials", "keyword": "false schema" }]
  },
  "document": { "apiVersion": "sirb/v1alpha1", "kind": "ModelBinding", "metadata": { "name": "x" }, "spec": {} }
}
```

| Field | Required | Meaning |
|---|---|---|
| `description` | yes | One sentence that says what the fixture proves. |
| `requirements` | yes | The `SR-SPEC-NN` IDs this fixture covers. There must be at least one. |
| `level` | yes | Must be `"schema"`. The value `"semantic"` is reserved for checks that JSON Schema cannot express (see below). |
| `expect.valid` | yes | Whether the document must be accepted. |
| `expect.errors` | when `valid` is `false` | Locators for the errors the validator must report. This field is not allowed when `valid` is `true`. |
| `document` | yes | The Sirb document under test. It can be any JSON value. |

### Error locators

Each entry in `expect.errors` has these fields:

- `instancePath` (required) is a JSON Pointer into `document`. The document root is `""`.
- `keyword` (required) is the JSON Schema keyword that failed. Names follow
  Ajv's vocabulary. Note that a `false` subschema, which the schemas use to
  forbid a property, is reported as `"false schema"`.
- `params` (optional) is a subset of the error's params, for example
  `{"missingProperty": "credentials"}`, `{"additionalProperty": "apiKey"}` or
  `{"propertyName": "authorization"}`.

### Matching rules

1. Validate the document with every error collected, not just the first
   (Ajv: `allErrors: true`).
2. The overall result must equal `expect.valid`.
3. Each expected error must match **at least one** reported error. They match
   when `instancePath` and `keyword` are equal and the expected `params` are a
   subset of the reported ones.
4. Extra reported errors are allowed. `if`/`then`, `oneOf` and `propertyNames`
   all emit wrapper errors that differ between validators.
5. Validate each document with the schema for its `kind`. Documents whose
   `kind` is unknown, or that have no `kind`, use `resource.schema.json`.
   `resource.schema.json` must also give the same result for every fixture,
   since it is the single entry point.

## Layout

```
conformance/
  fixture.schema.json
  fixtures/<kind>/valid-<slug>.json
  fixtures/<kind>/invalid-<slug>.json
  fixtures/resource/...        # envelope cases (apiVersion, kind, required fields)
```

`<kind>` is the kind name in lower case. A fixture's file name prefix must
agree with `expect.valid`, and the runner enforces this.

## Adding a fixture

1. Pick the kind directory and a short slug that says what is being tested.
2. Write the document. Every credential-shaped string must be an obviously
   fake placeholder, such as `"placeholder"` or `"Bearer not-a-real-token"`.
   Never use a real or real-looking key. The fixtures directory is in the
   gitleaks allowlist only so that these placeholders can be committed.
3. For an invalid fixture, run `npm test` once and take the `instancePath`
   and `keyword` of the error that best explains the failure from the printed
   Ajv errors. Pick the most specific one, not a wrapper like `if`.
4. Tag the fixture with the requirement IDs it covers.

## Traceability

> **Assumption:** `docs/requirements.md` was not in the repository when this
> suite was written. The IDs below are the assumed mapping recorded in
> [ADR-0001](../docs/adr/0001-record-architecture-decisions.md). Update both
> places once the requirements document lands.

| ID | Requirement (assumed) | Where it is verified |
|---|---|---|
| SR-SPEC-01 | There is a versioned JSON Schema (draft 2020-12) for each of the 8 kinds, plus a common envelope. | Fixtures tagged `SR-SPEC-01` and `test/schemas.test.mjs` |
| SR-SPEC-02 | ModelBinding supports `mode: byok \| billable`, fallbacks and a per-binding budget. | Fixtures tagged `SR-SPEC-02` |
| SR-SPEC-03 | Secrets appear only as `secretRef`, and inline secret values are rejected. | Fixtures tagged `SR-SPEC-03` and the secret meta-lint in `test/schemas.test.mjs` |
| SR-SPEC-04 | A documented conformance fixture format exists with at least 20 valid and invalid fixtures. | This document and `test/conformance.test.mjs` |
| SR-SPEC-05 | `npm test` runs in CI with actions pinned by commit SHA. | `.github/workflows/ci.yml` and `test/workflows.test.mjs` |

`test/traceability.test.mjs` fails if SR-SPEC-01, -02 or -03 has no valid
fixture or no invalid fixture. It also fails if any kind has no valid fixture
or no invalid fixture.

## Out of scope for `level: schema`

These rules are normative but cannot be expressed in JSON Schema. They are
reserved for future `level: "semantic"` fixtures (see
[ADR-0006](../docs/adr/0006-conformance-fixture-format.md)):

- Workflow step `id`s are unique, every `dependsOn` target exists, and the step graph is acyclic.
- Cross-resource references (`modelBinding`, `tools`, `fallbacks[].ref`, …) resolve to existing resources of the right kind.
- ModelBinding fallback chains contain no cycles.
- KnowledgeBase `chunking.overlap` is smaller than `chunking.size`.
