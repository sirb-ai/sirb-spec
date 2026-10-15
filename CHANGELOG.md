# Changelog

All notable changes to this package. See [VERSIONING.md](VERSIONING.md).

## 0.1.0

First release of the Sirb Agent Spec, `sirb/v1alpha1`.

- **Schemas:** JSON Schemas for Agent, Workflow, Tool, Memory, KnowledgeBase, ModelBinding, UIBinding and Policy.
- **ModelBinding:**
  - `mode: byok | billable`.
  - Ordered `fallbacks` with `triggers`.
  - A per-binding `budget`, with `limit` as a decimal string.
- **Reference loader** (`@sirb/spec`, `sirb-validate`):
  - Accepts YAML 1.2 and JSON.
  - Rejects aliases, merge keys, tags and duplicate keys.
  - Scans for literal secrets.
- **Conformance suite:** schema-level and loader-level fixtures, run by both a Node.js and a Python runner.
