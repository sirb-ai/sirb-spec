# 0008. Cross-resource references by name

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01

## Context

Resources refer to each other. For example, an Agent refers to a
ModelBinding, Tools, Memory, KnowledgeBases and Policies, and a ModelBinding
refers to its fallbacks.

## Decision

- A reference is a plain resource `name` string, with the same pattern as
  `metadata.name`. It resolves in the same namespace, and the kind is implied
  by the field.
- Whether the reference exists, and whether it points to the right kind, is a
  semantic check (ADR-0006), not a schema check.
- Typed or cross-namespace references (`{kind, name, namespace}`) will be
  reconsidered for v1beta1.

## Consequences

- Specs stay short and easy to diff.
- A dangling reference passes schema validation and fails only at
  apply-time or in semantic checks.

## Alternatives considered

- **Object references everywhere.** Verbose and redundant while every field
  implies a single kind. UIBinding `target` is the exception, because it can
  point to either an Agent or a Workflow, so it is `{kind, name}`.
