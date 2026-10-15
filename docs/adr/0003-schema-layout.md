# 0003. One schema per kind, a shared common schema and a dispatching envelope

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01

## Context

The scaffold had a single generic envelope at `schema/v1alpha1/agent.schema.json`.
That file name collided with the Agent kind.

## Decision

- Rename the envelope to `resource.schema.json`. It validates
  `apiVersion`, `kind` and `metadata`, then dispatches to the kind schema with
  `allOf` + `if: {kind: const}` / `then: {$ref}`. It is the single entry point
  for any Sirb document.
- Give each kind its own file: `agent`, `workflow`, `tool`, `memory`,
  `knowledgebase`, `modelbinding`, `uibinding`, `policy`
  (`<kind-lowercase>.schema.json`). Each one is complete and closed on its own.
- Put shared definitions in `common.schema.json` `$defs`: `name`, `ref`,
  `metadata`, `labels`, `secretRef`, `secretSource`, `httpsUrl`, maps and
  `retry`.
- Use `$id` = `https://sirb.ai/schemas/v1alpha1/<file>`. References between
  files are relative, so the files work offline and the URL does not need to
  resolve.
- **Close all objects.** Every object that declares `properties` has
  `additionalProperties: false`. A test enforces this.
- Model discriminated unions as a `type` enum plus a sibling block with the
  same name (for example `type: http` → `http: {...}`). Encode this with
  `if`/`then` blocks that require the matching block and forbid the others.
  This gives precise errors where `oneOf` would produce noisy ones.
- Versioning, freezing and migrations are defined in ADR-0009.

## Consequences

- Unknown fields are rejected. This catches typos and stops secrets from being
  hidden in extension fields, at the cost of extensibility. Extension points
  must be added to the schema on purpose.
- Every kind schema repeats the four-property envelope. That is preferred over
  `allOf` composition, which would need `unevaluatedProperties` to stay closed.

## Alternatives considered

- **One monolithic schema.** It is harder to review and gives worse error paths.
- **Open objects with an `x-` prefix convention.** Rejected because of SR-SPEC-03.
