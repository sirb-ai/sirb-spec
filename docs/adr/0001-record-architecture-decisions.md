# 0001. Record architecture decisions; assumed requirement IDs

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01 … SR-SPEC-05

## Context

The Sirb Agent Spec is a public contract between Sirb, its customers and
third-party tooling. Choices about schema shape, secrets and conformance need a
durable record. The work was scoped against requirements SR-SPEC-01 to
SR-SPEC-05 in `docs/requirements.md`, but that file was not in the
repository when v1alpha1 was written.

## Decision

- Record decisions as lightweight ADRs in `docs/adr/`, numbered sequentially, using `0000-template.md`.
- Until `docs/requirements.md` lands, use this **assumed** mapping. It is
  derived from the work request, and the conformance suite traces to it:

| ID | Assumed requirement |
|---|---|
| SR-SPEC-01 | There is a versioned JSON Schema (draft 2020-12) for each of Agent, Workflow, Tool, Memory, KnowledgeBase, ModelBinding, UIBinding and Policy under `schema/v1alpha1`, with a common envelope. |
| SR-SPEC-02 | ModelBinding supports `mode: byok \| billable`, ordered fallbacks and a per-binding budget. |
| SR-SPEC-03 | Secrets appear only as `secretRef` references. Inline secret values are rejected. |
| SR-SPEC-04 | A documented conformance fixture format exists, with at least 20 valid and invalid fixtures. |
| SR-SPEC-05 | `npm test` validates the suite and runs in GitHub Actions, with actions pinned by commit SHA. |

## Consequences

- Reviewers can trace every fixture to a requirement.
- If the real requirements differ, ADR-0001, `conformance/README.md` and the
  `requirements` tags in the fixtures must be updated together.

## Alternatives considered

- **Wait for the requirements document.** This would block the work on a missing file.
- **Drop the IDs.** This would lose traceability, which costs little to keep.
