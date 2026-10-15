# 0004. Secrets by reference only; errors for secret fields, warnings for free text

- **Status:** Accepted (revised after the PR #1 review and re-review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-04

## Context

SR-SPEC-04 says that secrets appear only as `secretRef` and that the loader
must reject literal keys.

The first review got 21 literal credentials past the schema. Closing them
with substring denylists caused the following problems:
- **False positives:** `KEYBOARD_LAYOUT`, `authorName`, `tokenCount`, `x-session-id`, `?country_code=`, `ssh://git@…`, and resource names starting `sk-`.
- **Hard failures on prose:** an Agent's `instructions` were rejected for mentioning a key.
- **ReDoS risk:** the secret regexes contained unbounded repeats.

## Decision

**Severity follows intent.** A literal is a hard **error** only in a field
that is *meant to hold a secret*. Credential-shaped text anywhere else is a
**warning**. It is reported but does not make the document invalid.

| Where | Rule | Severity |
|---|---|---|
| Secret fields: `credentials`, `clientSecret`, `connection`, `botToken`, `signingSecret`, `appPassword`, `secretEnv` values | Must be `{secretRef}` (schema). | error |
| Fields whose name says they hold a secret: workflow `input`/`outputs` keys such as `apiKey` or `accessToken`, `inputSchema` properties such as `dbPassword` (their `default`, `const`, `enum` and `examples`), and any other key whose last word names a secret | Must be a `secretRef`. A literal of any shape is rejected. | error (schema for value maps, loader `literal-secret` elsewhere) |
| Credential channels: URLs, HTTP header names and values, env var names and values, `mcp.args`, `mcp.command`, `auth`, `secretRef.key` | Credential shapes, secret-named headers and env vars, secret-named CLI flags, URL userinfo and credential query parameters are rejected (schema). | error |
| Free text and metadata: `instructions`, `description`, `greeting`, `when`, labels, resource names, non-secret value-map entries, keys | A credential shape is reported. | warning (loader `possible-secret`) |

**What counts as a secret name.** A name is split into words (kebab-case,
snake_case, SCREAMING_SNAKE, camelCase). It is a secret name when its **last
word** is one of:
- `token`, `secret`, `password`, `passwd`, `passphrase`
- `credential(s)`, `auth`, `authorization`, `oauth`
- `signature`, `sig`, `cookie`, `dsn`
- `apikey`, `privatekey`, `secretkey`, `accesskey`
- `pwd`, but only as the last word of a longer name (`DB_PWD`). A bare `PWD`
  is the shell's working directory.

A name also counts when it ends in `key`:
- In env var and header names, a trailing `key` counts unless the word
  before it is a known non-secret qualifier (`idempotency`, `cache`,
  `partition`, `sort`, `routing`, …). So `OPENAI_KEY` and `x-api-key` are
  secrets, while `x-idempotency-key` and `CACHE_KEY` are not.
- In data keys and URL parameters, a trailing `key` counts only after a
  credential qualifier (`api`, `private`, `access`, `client`,
  `subscription`, …), or when it is the whole name. So `partitionKey` and
  `cacheKey` stay data.

The rule lives in `src/secret-names.mjs`. `scripts/gen-secret-patterns.mjs`
generates the matching schema regexes from it, and a test fails if the two
drift apart or disagree on any test vector.

**Credential shapes** (`common.schema.json`, shared with the loader):
- provider prefixes at a word boundary: OpenAI and Anthropic `sk-`, GitHub,
  GitLab, Slack, npm, PyPI, Hugging Face, Shopify, DigitalOcean, Google
  (`AIza`, `ya29.`), AWS, PEM and JWT
- URLs whose path is the secret: Slack and Discord webhooks
- Azure `AccountKey=` and `SharedAccessSignature=`
- standalone 32-digit hex strings, the shape of Azure AI and Cognitive
  Services keys. Header and env var names whose last word marks an
  identifier or digest (`x-request-id`, `etag`, `if-match`, `TENANT_ID`,
  `CONFIG_MD5`, `*_SHA256`, …) may hold hex. The loader skips this check for
  such fields too.
- `scheme://user:pass@`. A user without a password, as in `git@`, is allowed.
- `bearer|basic|digest|token <value>`
- credential-named parameters in the URL query, **fragment** (`#access_token=`)
  or matrix part (`;token=`), including `X-Amz-Signature` and `sig`
- **percent-encoded** parameter names in URLs (`?api%5Fkey=`). These are
  rejected outright, because they hide a secret name from the rules above.
  Credential prefixes also count after a percent-escape (`Bearer%20sk-…`),
  and the loader re-checks free text after percent-decoding it.
- **YAML comments.** The loader scans every comment token and reports
  credential shapes as `possible-secret` warnings, with the line number.
  Comments are not fields, so these are warnings even when the document is
  otherwise invalid.
- high-entropy tokens (loader only): at least 24 characters, mixed case plus
  digits, no seven-letter lower-case run, and at least 4.0 bits per character

**Linear-time matching.** Every repeat in every schema pattern and every
loader shape is bounded (`{0,256}`, never `*` or `+`). A test enforces this.
A second test loads 1 MB adversarial documents, in both JSON and YAML, that
target each pattern's worst case, and requires each to finish in under one
second.

**Repository hygiene.** gitleaks runs in CI and as a pre-commit hook. It
allowlists only findings whose matched text contains the marker `FAKE` or the
one sequential hex placeholder. A CI canary step checks that a real-looking
key in a fixture is still reported (ADR-0007).

## Consequences

- Every bypass reported so far has a fixture, and so has every false positive
  fixed so far.
- A document can be valid and still carry warnings. Tooling should show them,
  and `sirb-validate` prints them.
- Secrets that a heuristic cannot recognise remain possible in free text. The
  warnings, gitleaks and review cover that residual risk.

## Alternatives considered

- **Hard errors everywhere** (the previous decision). This rejects legitimate
  prose and names, and pushes authors to work around the check.
- **Substring denylists.** Simple, but the cause of most of the false positives above.
