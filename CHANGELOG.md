# Changelog

All notable changes to this package. See [VERSIONING.md](VERSIONING.md).

## 0.3.0

**Breaking** (alpha): the policy pattern subset is stricter, and some
schema rules changed.

- **Policy patterns:**
  - `*`, `+`, `{n,}` and repeated groups are rejected; use bounded repeats.
  - `compilePolicyPattern()` matches with RE2 semantics (`re2js`) and a
    128-instruction complexity cap.
  - The loader reports `invalid-regex`.
- **New credential checks:**
  - 32-hex keys (Azure AI). Identifier and digest header and env names are
    exempt.
  - Credential parameters in URL fragments and matrix parameters.
  - Percent-encoded URL parameter names, and credential prefixes after
    percent-escapes.
  - YAML comments, reported as warnings with a line number.
- **False positives fixed:** `x-idempotency-key`, `CACHE_KEY` and similar
  `*-key` names with a non-secret qualifier, and a bare `PWD`/`OLDPWD`.
- The nesting pre-check is no longer fooled by apostrophes in plain text.
- gitleaks: the allowlist now actually applies, and a CI canary proves real
  keys are still reported.

## 0.2.0

**Breaking** (alpha): the loader result and some schema rules changed.

- **Loader:**
  - Every issue now has a `severity`. Only errors make a result invalid.
  - `possible-secret` warnings replace hard errors for credential-shaped free
    text (instructions, descriptions, labels, keys).
  - `literal-secret` is now reported for any literal in a field meant to
    hold a secret, whatever its shape.
  - `load()` and `loadFile()` never throw. New issue codes: `too-deep`,
    `forbidden-key`, `invalid-input`, `invalid-format`, `io` and `internal`.
  - The new `maxDepth` limit defaults to 64.
  - Duplicate-key detection is now linear.
- **Schema:**
  - Secret names are matched by whole last word, so `KEYBOARD_LAYOUT`,
    `authorName`, `tokenCount`, `x-session-id` and `?country_code=` are no
    longer rejected. Env names ending in `_KEY` are rejected.
  - Secret-named CLI flags in `mcp.args` are rejected.
  - More credential shapes are recognised: webhook URLs, Azure connection
    strings and SAS, npm, PyPI, Hugging Face, Shopify, DigitalOcean and
    Google OAuth tokens, and presigned-URL signatures.
  - User-only URL userinfo (`git@`) is allowed.
  - Free text, labels and resource names are no longer checked by the schema.
  - Every pattern repeat is bounded.

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
