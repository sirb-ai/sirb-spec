# 0004. Secrets by reference only; the loader rejects literal keys

- **Status:** Accepted (revised after the PR #1 review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-04

## Context

Agent specs get committed to git, pasted into tickets and shown in UIs.
SR-SPEC-04 says that secrets appear only as `secretRef` **and that the loader
must reject literal keys**.

The first version relied on the schema alone. The review got 21 literal
credentials past it, through:
- URL userinfo and query strings
- `mcp.args` and `mcp.command`
- Workflow inputs and outputs
- `inputSchema` defaults
- header and env names that were not on the denylist
- lower-case or space-prefixed `bearer` values
- `secretRef.key`

A schema cannot recognise every secret by its value, so the defence has to be
layered.

## Decision

**Layer 1: structure (schema).**
1. The only way to carry a secret is `secretRef: {name, key?, store?}`. Every
   secret-bearing field is a `secretSource` (`{secretRef}` and nothing else):
   `credentials`, `clientSecret`, `connection`, `botToken`, `signingSecret`,
   `appPassword`, and `secretEnv` values. Tool `auth` uses `credentials`, the
   same shape as everywhere else, and each auth type forbids the fields of
   the other types.
2. Every object is closed (ADR-0003). There are no `annotations`.
3. Workflow `input` and `outputs` give secrets a proper path: any value may be
   a `secretRef`, and keys that name a secret (`apiKey`, `token`, `password`,
   `auth`, …, case-insensitive) *must* be one.

**Layer 2: value shape (schema).** These definitions live in
`common.schema.json` and are shared with the loader, so the two cannot drift
apart:
- `knownTokenPattern` matches provider key prefixes at a word boundary, for example
  `sk-`, `ghp_`/`gho_`/`ghs_`, `github_pat_`, `glpat-`, `xox?-`, `AKIA…`, `AIza…`,
  `-----BEGIN`, and JWTs.
- `urlUserinfoPattern` matches `scheme://user[:pass]@`.
- `authSchemePattern` matches `bearer|basic|digest|token <value>`. It is
  case-insensitive and ignores leading spaces.
- `credentialQueryPattern` matches query parameters named like credentials:
  `api_key`, `token`, `sig`, `code`, ….

These patterns are applied as follows:
- `httpsUrl` has no userinfo, must have a host, and rejects credential query
  parameters. Credentials in a query string go through `auth: {type: api-key, in: query}`.
- `nonSecretValue` covers header values, env values, `mcp.args` and
  `mcp.command`. The command also may not start with an inline `VAR=value`.
- `text` covers free text, labels, `secretRef.name` and `secretRef.key`.
- Header names are denylisted if they match
  `auth|cookie|token|secret|passw|key|credential|session|signature|subscription`.
- Env names are denylisted if they match
  `KEY|TOKEN|SECRET|PASSW|PWD|CREDENTIAL|AUTH|DSN|CONN_?STR`.

**Layer 3: the loader scan (`src/secrets.mjs`).** After validation, the
reference loader scans **every string and every key** in the document:
- It applies the four shapes above.
- It also flags high-entropy tokens: at least 24 characters, mixed case plus
  digits, no run of seven or more lower-case letters, and Shannon entropy of
  at least 4.0 bits per character.
- Any finding produces `literal-secret`, and the document is rejected.
- This scan is what covers places the schema leaves free-form on purpose, such
  as `inputSchema` and `instructions`.
- Messages never echo the value.

**Layer 4: repository hygiene.** gitleaks runs in CI and in pre-commit. It
allowlists fixture findings only when they contain the marker `FAKE`, not
whole paths.

**Meta-lint.** `test/schemas.test.mjs` fails in these cases:
- an object that declares properties is not closed
- an object without declared properties is free-form without being an
  explicitly exempted map
- a property whose name looks secret (unanchored, plurals included) is not a
  `secretSource`

## Consequences

- Every bypass the review found now has a fixture. Each one is rejected by the
  schema, by the loader, or by both.
- There are false positives, and they are deliberate. Examples: a header named
  `x-session-id`, an env var named `KEYBOARD_LAYOUT`, a query parameter named
  `code`, or a 24-character mixed-case random-looking ID. The fix is to rename
  the field, or to move the value to a `secretRef`. This trade is right for a
  format whose failure mode is a leaked key.
- The entropy heuristic is a heuristic. An opaque low-entropy secret in free
  text can still pass, so gitleaks and review remain part of the defence.
- Runtimes must resolve `secretRef` at execution time and must never write the
  resolved value back into a document.

## Alternatives considered

- **Schema-only enforcement.** The review showed this cannot meet "the loader
  must reject literal keys".
- **Allowing `value` with a lint warning.** Warnings get ignored.
- **A path-wide gitleaks allowlist for fixtures.** It would hide a real key
  pasted into a fixture.
