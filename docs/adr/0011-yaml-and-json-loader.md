# 0011. Reference loader: YAML 1.2 and JSON

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-03, SR-SPEC-04

## Context

SR-SPEC-03 requires that YAML and JSON are both accepted. SR-SPEC-04 requires
that the loader rejects literal keys. The first PR had neither a loader nor
YAML support. Some YAML features are also hazards:
- Aliases allow "billion laughs" expansion.
- Merge keys and duplicate keys can hide content from reviewers.
- Tags allow type smuggling.
- YAML 1.1 resolves `on`, `yes` and `no` as booleans.

## Decision

- Ship a reference loader in this package: `src/` (`load`, `loadOrThrow`,
  `loadFile`, `parse`) and the `sirb-validate` CLI. Its steps are:
  1. Parse with `yaml` 2.x as **YAML 1.2, core schema**, strict, with `uniqueKeys`.
     JSON input is first checked with `JSON.parse` so that the syntax is
     strict. It then goes through the same pipeline, which also catches
     duplicate keys.
  2. Reject anchors and aliases, merge keys, explicit tags, non-string keys,
     duplicate keys, documents that are not mappings, input over 1 MiB, and
     streams of more than 100 documents. A document with any of these issues
     is never converted to a JavaScript object, so aliases are never expanded.
  3. Validate each document against its kind schema (ADR-0002).
  4. Scan every string and key for literal secrets (ADR-0004).
- Issues have a stable `code` and a `severity` (`error` or `warning`), so
  the conformance suite can assert them (ADR-0006). A result is valid when
  no issue is an error.
- **`load()` never throws.** This holds for any input: non-strings, invalid
  UTF-8, unknown formats, `kind: constructor`/`__proto__`/`toString`,
  `__proto__` keys and nesting bombs all come back as issues. As a last
  resort, an unexpected failure is reported as an `internal` issue.
  `loadFile()` reports read failures as `io` issues. Only `loadOrThrow()`
  throws, and that is its purpose.
- Kind lookup uses a frozen null-prototype map and `Object.hasOwn`.
  `__proto__` keys are rejected (`forbidden-key`), so a loaded document can
  never carry a prototype-changing key to downstream code.
- **Limits.** The limits are 1 MiB of input, 100 documents, and 64 nested
  mappings or sequences (counting the document root). Flow nesting (`[[[[…`)
  is measured on the raw text before parsing, so it cannot exhaust the
  parser. Block nesting is measured with an iterative walk. All of these are
  configurable through options.
- Duplicate keys are detected with a `Set` for each mapping. The `yaml`
  library's own `uniqueKeys` check is quadratic: a 1 MB document with 30,000
  keys took about 10 seconds with it.
- Multi-document YAML streams (`---`) are allowed. Each issue names its
  `document` index.
- The .NET runtime must implement the same steps, using a YAML 1.2 parser and
  the same rejection list, and must pass the `loader/` fixtures.

## Consequences

- `ajv`, `ajv-formats` and `yaml` become runtime dependencies, pinned to exact versions.
- The loader-level fixtures are written as raw text, so they apply unchanged
  to any loader implementation.

## Alternatives considered

- **JSON only.** Rejected because of SR-SPEC-03.
- **YAML 1.1 parsers (`js-yaml` defaults, PyYAML).** The `on`/`yes` coercions
  change what a document means.
