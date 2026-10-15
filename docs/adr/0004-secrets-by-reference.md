# 0004. Secrets by reference only

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-03

## Context

Agent specs get committed to git, pasted into tickets and rendered in UIs.
A spec format that lets a user inline an API key will end up with leaked keys.
JSON Schema cannot recognise a secret by looking at its value, so the defence
has to come from the structure of the schema.

## Decision

1. **The only secret carrier is `secretRef`.** It has the form
   `{name, key?, store?}`, and `store` is one of `sirb`, `kubernetes`,
   `vault`, `aws-secrets-manager`, `gcp-secret-manager` or `azure-key-vault`.
   There is no `value` or `valueFrom` property anywhere in the spec.
2. **Every secret-bearing field is a `secretSource`** (`{secretRef}` and
   nothing else). This covers `credentials`, `clientSecret`, `connection`,
   `botToken`, `signingSecret` and `appPassword`. A string value fails with
   `type`. An `apiKey` sibling fails with `additionalProperties`.
3. **All objects are closed** (ADR-0003), so `secretRef.value` and similar
   fields are rejected.
4. **Free-form maps are limited.**
   - `httpHeaders` keys must be lower case. Keys that match
     `authorization|cookie|token|secret|passw|api-?key|credential|private-?key|session`
     are rejected.
   - `envVars` keys must be UPPER_SNAKE. Keys that match
     `TOKEN|SECRET|PASSW|API_?KEY|CREDENTIAL|PRIVATE_?KEY` are rejected.
   - Values in both maps are rejected if they start with a known credential
     prefix (`Bearer `, `Basic `, `sk-`, `ghp_`, `xox?-`, `AKIA`, `AIza`,
     `-----BEGIN`, …).
   - Forcing the case first is what makes a single-case denylist sound, since
     ECMA-262 regexes have no inline `(?i)`.
   - Secret environment variables go through `secretEnv`, which maps a name
     to a `secretSource`.
   - Credential headers go through `auth` (`bearer`, `api-key`,
     `oauth2-client-credentials`).
5. **There are no `annotations` in v1alpha1.** `labels` values are restricted
   to `^[A-Za-z0-9._-]{0,63}$`.
6. **A meta-lint (`test/schemas.test.mjs`) makes this a regression test.** It
   fails if any object declaring `properties` is not closed, if any free-form
   object is neither a declared map nor explicitly exempt, or if any property
   with a secret-like name is not a `secretSource`.
7. **gitleaks** (pre-commit) is the complementary control for free text such
   as `Agent.spec.instructions`, which a schema cannot police. The conformance
   fixtures need credential-shaped placeholder strings, so
   `conformance/fixtures/` is in the gitleaks allowlist in `.gitleaks.toml`.

## Consequences

- A whole class of leaks is ruled out by construction. Fixtures cover inline
  keys, inline connection strings, `secretRef.value`, `authorization` headers,
  `*_API_KEY` env vars and literal bearer values.
- The value heuristics are defence in depth, not a guarantee. An opaque random
  string in a non-secret field still passes.
- Runtimes must resolve `secretRef` at execution time and must never write the
  resolved value back into a document.

## Alternatives considered

- **`value` allowed with a lint warning.** Rejected because warnings get ignored.
- **`format: "secret"` annotations.** These are not enforced by validators.
