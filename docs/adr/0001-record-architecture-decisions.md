# 0001. Record architecture decisions; requirement IDs

- **Status:** Accepted (requirement mapping revised after the PR #1 review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01 … SR-SPEC-05

## Context

The Sirb Agent Spec is a public contract between Sirb, its customers, and
both of its runtimes (Node.js and .NET). The work is scoped against
requirements SR-SPEC-01 to SR-SPEC-05 in `docs/requirements.md`. That file is
**not in this repository**.

The first version of this ADR guessed the mapping, and the PR #1 review
showed that the guess was wrong. The review quotes the requirement text and
assigns secret handling to SR-SPEC-04.

## Decision

- Record decisions as ADRs in `docs/adr/` using `0000-template.md`.
- Use this mapping. The **Source** column says how much of each row is known:

| ID | Requirement | Source |
|---|---|---|
| SR-SPEC-01 | There are JSON Schemas (draft 2020-12) under `schema/v1alpha1` for the eight kinds: Agent, Workflow, Tool, Memory, KnowledgeBase, ModelBinding, UIBinding and Policy. | Inferred from the work request. |
| SR-SPEC-02 | ModelBinding supports `mode: byok \| billable`, fallbacks and a per-binding budget. | Inferred from the work request. |
| SR-SPEC-03 | YAML and JSON are accepted. | The requirement text is quoted by the review. **The ID is assumed.** |
| SR-SPEC-04 | Secrets appear only as `secretRef`, and the loader must reject literal keys. | **Confirmed** by the review. |
| SR-SPEC-05 | The spec is versioned with semver. Breaking changes need a new apiVersion and a migration. | The requirement text is quoted by the review. **The ID is assumed.** |

- The conformance fixture format and the CI pipeline are deliverables of the
  work request. They are not separate requirement IDs.
- The mapping is defined in three places: this ADR, `conformance/README.md`
  and `test/traceability.test.mjs`. All three change together.

## Consequences

- Every fixture traces to a requirement, and `test/traceability.test.mjs`
  checks coverage.
- Until `docs/requirements.md` is added, the IDs for 01, 02, 03 and 05 may
  still move. Retagging is a mechanical edit to the fixtures.

## Alternatives considered

- **Keep the original guess.** The review showed it was wrong for SR-SPEC-04.
- **Drop the IDs until the document lands.** That would lose traceability for no gain.
