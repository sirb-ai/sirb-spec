# Sirb Agent Spec conformance suite

This suite pins down the behaviour of `sirb/v1alpha1` schemas, loaders and
agent runtimes. It is written so that any implementation can run it (Node.js,
.NET, editors, operators), not just the reference one.

There are two reference runners in this repository:

| Runner | Covers | Command |
|---|---|---|
| Node.js (Ajv 2020, strict) and the reference loader | every `schema` and `loader` fixture. For `runtime` fixtures: their shape, their embedded documents and their internal consistency only. | `npm test` |
| Python (`jsonschema` 4.26) | `level: schema` fixtures, and the embedded documents of `runtime` fixtures | `python -I conformance/runners/python/run_conformance.py .` |

CI runs both. If the two disagree on any verdict or locator, the build fails.

**Neither runner here executes `level: runtime` behaviour**, because this
package has no agent runtime. `npm test` lists each runtime fixture's
behaviour test as *skipped*. The runtime runners live in sirb-js and
sirb-dotnet, and both must pass every runtime fixture
([ADR-0012](../docs/adr/0012-runtime-conformance-fixtures.md)).

## Fixture format

A fixture is one JSON file. Its shape is defined by
[`fixture.schema.json`](fixture.schema.json). There are three levels.

### `level: schema`

The fixture holds a parsed document and the result of validating it against the JSON Schemas.

```json
{
  "description": "billable bindings must not carry customer credentials",
  "requirements": ["SR-SPEC-02"],
  "level": "schema",
  "expect": { "valid": false, "errors": [{ "instancePath": "/spec/credentials", "keyword": "false" }] },
  "document": { "apiVersion": "sirb/v1alpha1", "kind": "ModelBinding", "metadata": { "name": "x" }, "spec": {} }
}
```

### `level: loader`

The fixture holds raw YAML or JSON text and the result of running it through a
conforming loader. A loader parses the text, validates every document in it,
and scans for literal secrets.

```json
{
  "description": "anchors and aliases are rejected",
  "requirements": ["SR-SPEC-03"],
  "level": "loader",
  "format": "yaml",
  "source": "metadata: {name: &n support}\nspec: {modelBinding: *n}\n",
  "expect": { "valid": false, "errors": [{ "code": "yaml-alias" }] }
}
```

### `level: runtime`

> **Proposed** in [ADR-0012](../docs/adr/0012-runtime-conformance-fixtures.md),
> which is the normative description of runner duties, the neutral transcript,
> the step trace, span and usage rules, and the matching rules.

The fixture holds a set of Sirb documents, a **scripted model** (canned turns:
text, structured objects, tool calls, errors and token usage), **stub tools**
with canned results, and the runs to execute. A runner must not use the
network, a real model or real secrets. `expect` asserts what can be observed:
the final output, the ordered step trace (model calls, tool calls and
retries), tool arguments, memory reads and writes, spans and usage records.
`expect.valid` means that every run completes without an error. A run that
fails is listed in `expect.errors` as `{code, run}`.

```json
{
  "description": "a plain text reply ends the run after one model call",
  "requirements": ["SR-RT-02"],
  "level": "runtime",
  "documents": [{ "kind": "Agent", "…": "…" }, { "kind": "ModelBinding", "…": "…" }],
  "agent": "greeter",
  "model": { "turns": [{ "text": "Hello!", "usage": { "inputTokens": 25, "outputTokens": 9 } }] },
  "runs": [{ "input": "Hello" }],
  "expect": { "valid": true, "runs": [{ "output": { "text": "Hello!" }, "steps": [{ "type": "model", "turn": 0 }] }] }
}
```

Run error codes are `structured-output-invalid`, `model-error` and
`max-iterations`. MCP tool fixtures and Postgres-backed runs are covered in
ADR-0012. CLI behaviour (`sirb init`, `sirb dev`) is not tested at this level.

### Fields

| Field | Required | Meaning |
|---|---|---|
| `description` | yes | One sentence that says what the fixture proves. |
| `requirements` | yes | The `SR-SPEC-NN` or `SR-RT-NN` IDs the fixture covers ([traceability](#traceability)). |
| `level` | yes | `schema`, `loader` or `runtime`. |
| `expect.valid` | yes | Whether the input must be accepted. For `runtime`: whether every run completes without an error. |
| `expect.errors` | when invalid | Error locators. At least one actual error must match each locator. |
| `document` | `schema` only | The document under test. It can be any JSON value. |
| `source`, `format` | `loader` only | The raw text, and whether it is `yaml` or `json`. |
| `documents`, `agent`, `model`, `runs` | `runtime` only | The documents, the Agent to run, the scripted model, and the runs. |
| `tools` | `runtime`, when the agent has tools | One stub for each of the agent's tools. |
| `expect.runs` | `runtime` only | Per run: `output`, the exact `steps`, and the exact `memory` operations. |
| `expect.spans`, `expect.usage` | `runtime`, optional | All spans and usage records across all runs. When present, the count must match exactly. |

### Error locators

Locators use the vocabulary of the JSON Schema standard output format, so they
do not depend on any one validator.

| Field | Meaning |
|---|---|
| `instancePath` | JSON Pointer into the document (the standard `instanceLocation`). The root is `""`. |
| `keyword` | The standard keyword that failed (`required`, `pattern`, `not`, …). A `false` subschema is `"false"`. |
| `property` | *Informative.* The property named by a `required`, `additionalProperties` or `propertyNames` failure. Runners that cannot report it (such as the standard output format) skip this check. |
| `code` | `loader` level: the loader issue code (see below). `runtime` level: the run error code. |
| `document` | `loader` level only. The index of the document within a multi-document stream. |
| `run` | `runtime` level only. The index of the run that ended with the error. |

At the `loader` level, `expect.errors` is matched against issues whose
`severity` is `error`. `expect.warnings` is matched against issues whose
`severity` is `warning`. Warnings never affect `valid`, so a valid fixture
can still list warnings.

For a failure inside `propertyNames`, `instancePath` is the object being
checked and `keyword` is the inner keyword that failed (`pattern` or `not`).

### Matching rules

1. Validate with every error collected and **format assertion on**. Format
   assertion is required for conformance: several fixtures fail *only* on
   `format` (`uri`, `uuid`, `hostname`).
2. The verdict must equal `expect.valid`.
3. Each expected locator must match at least one reported error, meaning every
   field the locator gives is equal (apart from `property` where the runner
   cannot report it). Extra reported errors are fine.
4. `schema` level: validate with the schema for the document's `kind`. Unknown
   or missing kinds use `resource.schema.json`. The reference runner also
   requires `resource.schema.json` to give the same verdict, and requires the
   loader to agree on both a JSON and a YAML encoding of the document. Every
   schema fixture therefore also has a YAML twin.
5. Known validator quirk: python-jsonschema 4.26 reports a `false`-schema
   failure at the *parent* object. The Python runner accepts the parent path
   for `keyword: "false"` only.

### Loader issue codes

| Code | Meaning |
|---|---|
| `syntax` | The text is not well-formed YAML 1.2 or JSON. |
| `duplicate-key` | The same mapping key appears twice. |
| `yaml-alias` | The text uses an anchor (`&`) or alias (`*`). |
| `yaml-merge-key` | The text uses a merge key (`<<`). |
| `yaml-tag` | The text uses an explicit tag (`!!binary`, `!custom`, …). |
| `non-string-key` | A mapping key is not a string (`1:`, `true:`, `~:`). |
| `not-an-object` | A document is not a mapping. |
| `forbidden-key` | A `__proto__` key appears anywhere. |
| `empty`, `too-large`, `too-many-documents`, `too-deep` | Limits on the input: 1 MiB, 100 documents, and 64 nested collections by default. |
| `invalid-input`, `invalid-format`, `io` | The input is not text or bytes, the format is unknown, or the file cannot be read. |
| `schema` | A schema violation. The issue also carries `instancePath` and `keyword`. |
| `invalid-regex` | A policy pattern exceeds the complexity cap or does not compile in the linear-time engine (ADR-0010). |
| `literal-secret` | A literal value in a field meant to hold a secret (for example `dbPassword: {default: …}`). |
| `possible-secret` | **Warning.** A credential-shaped value outside secret fields, for example in free text, labels, keys or YAML comments. Comment findings carry `line` instead of `instancePath`. |
| `internal` | Unexpected loader failure, reported as an issue instead of thrown. |

Every code is an `error` except `possible-secret`, which is a `warning`. See
[ADR-0004](../docs/adr/0004-secrets-by-reference.md).

## Layout

```
conformance/
  fixture.schema.json
  fixtures/<kind>/(valid|invalid)-<slug>.json   # level: schema
  fixtures/resource/...                          # envelope cases
  fixtures/loader/(valid|invalid)-<slug>.json    # level: loader
  fixtures/runtime/(valid|invalid)-<slug>.json   # level: runtime (invalid = a run ends in error)
  runners/python/                                # second validator
```

A fixture's file name prefix must agree with `expect.valid`, and the runner enforces this.

## Adding a fixture

1. Pick the directory and a slug that says what is being tested.
2. Every credential-shaped placeholder must contain the marker `FAKE`, for
   example `ghp_FAKEFAKE…` or `sk-ant-api03-FAKE…`. For 32-hex keys, use
   only `0123456789abcdef0123456789abcdef`. gitleaks runs in CI and
   allowlists only findings that contain that marker. Never paste a real key.
3. For an invalid fixture, choose the error that best explains the failure,
   using its `instancePath` and the standard `keyword`. Do not choose a wrapper
   such as `if`, `allOf` or `anyOf`, because validators report wrappers
   differently.
4. Tag the requirement IDs.
5. Run `npm test`. If you have Python, also run the Python runner.

## Traceability

> Only SR-SPEC-04 is confirmed (by the PR #1 review). The other IDs were
> inferred because `docs/requirements.md` is not in this repository. See
> [ADR-0001](../docs/adr/0001-record-architecture-decisions.md). When the
> requirements document lands, update ADR-0001, this table and
> `test/traceability.test.mjs` together.

| ID | Requirement | Verified by |
|---|---|---|
| SR-SPEC-01 | There are JSON Schemas (draft 2020-12) for the eight kinds and a common envelope. | Fixtures tagged SR-SPEC-01 and `test/schemas.test.mjs` |
| SR-SPEC-02 | ModelBinding supports `mode: byok \| billable`, fallbacks and a per-binding budget. | Fixtures tagged SR-SPEC-02 |
| SR-SPEC-03 | YAML and JSON are accepted. | `loader/` fixtures and the YAML twin of every schema fixture |
| SR-SPEC-04 | Secrets appear only as `secretRef`, and the loader rejects literal keys. | Fixtures tagged SR-SPEC-04 (schema and loader), plus the secret meta-lint |
| SR-SPEC-05 | The spec is versioned with semver, and breaking changes need a new apiVersion and a migration. | `test/versioning.test.mjs` and [VERSIONING.md](../VERSIONING.md) |

> **Draft.** The SR-RT rows below are proposed in
> [`docs/requirements.md`](../docs/requirements.md). The owner has not yet
> confirmed which ID covers which item.

| ID | Requirement (draft) | Verified by |
|---|---|---|
| SR-RT-01 | Load and validate v1alpha1; `defineAgent()` produces the same spec object. | The `schema` and `loader` fixtures run by each runtime, runtime fixtures tagged SR-RT-01, and a `defineAgent()` round-trip in each runtime |
| SR-RT-02 | Single-agent run loop with typed tools and MCP tools. | Runtime fixtures tagged SR-RT-02 (MCP fixtures to follow) |
| SR-RT-03 | Structured output with retry. | Runtime fixtures tagged SR-RT-03 |
| SR-RT-05 | In-memory and Postgres memory store. | Runtime fixtures tagged SR-RT-05, run against each store |
| SR-RT-06 | An OpenTelemetry span for every step. | Runtime fixtures tagged SR-RT-06 |
| SR-RT-07 | A usage record for every model call, idempotent by `request_id`, `byok \| billable`. | Runtime fixtures tagged SR-RT-07 |
| SR-RT-10 | `sirb init`, `sirb dev`. | CLI smoke tests in sirb-js and sirb-dotnet, not fixtures |

`test/traceability.test.mjs` checks the following:
- SR-SPEC-01 to 04 each have at least one valid and one invalid fixture.
- SR-SPEC-03 has valid fixtures in both YAML and JSON.
- SR-SPEC-04 includes loader-level `literal-secret` rejections.
- Every kind has at least two valid fixtures and at least one invalid fixture.
- SR-RT-01, 02, 03, 05, 06 and 07 each have at least one runtime fixture.
  SR-RT-03 also has one where the retries run out.
- SR-RT IDs appear only on runtime fixtures, and runtime fixtures cite only SR-RT IDs.
- `docs/requirements.md` has a row for every SR-RT ID, and its draft marker is still present.

## Not covered yet

These rules are normative but cannot be expressed in JSON Schema. They need a
future `level: semantic`:

- Workflow step `id`s are unique, every `dependsOn` target exists, and the step graph is acyclic.
- Cross-resource references resolve to an existing resource of the right kind.
- ModelBinding fallback chains contain no cycles.
- KnowledgeBase `chunking.overlap` is smaller than `chunking.size`.
