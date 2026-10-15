# 0010. Cross-runtime portability (Node.js and .NET)

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-01, SR-SPEC-02, SR-SPEC-04

## Context

The same documents must validate the same way in Ajv (Node.js),
JsonSchema.Net (.NET) and other validators, and must bind to native types in
both runtimes. The review and the second-validator run found several
divergences:
- `format: regex` meant ECMAScript in one validator and .NET `Regex` in another.
- User-supplied policy patterns could backtrack catastrophically (ReDoS).
- Integers had no upper bound, and money was stored as a float.
- The function runtimes had no .NET option.
- `$` matched before a trailing newline in Python and .NET but not in
  ECMAScript. As a result, `metadata.name: "support\n"` was valid in one
  runtime and invalid in the others.

## Decision

- **Schema patterns** use only the subset that ECMAScript, .NET and Python
  share. Inline flags are not used: case-insensitive matches are written as
  `[Aa]` classes. End of input is written `(?![\s\S])`, never `$`, and the
  meta-lint enforces this. A fixture covers the trailing-newline case.
- **User-supplied regexes** (`Policy.match.patterns`) use `safeRegex`. It is a
  portable subset with no lookaround, backreferences, inline flags, named
  groups, atomic groups or possessive quantifiers. Case-insensitive matching
  uses `match.caseInsensitive`. **Runtimes must evaluate these patterns with a
  linear-time engine** (RE2/`re2` in Node.js, `RegexOptions.NonBacktracking`
  in .NET) or a match timeout of 100 ms or less. `format: regex` is banned by
  the meta-lint.
- **Numbers:** every `integer` and `number` has a `maximum`. Counts and
  durations fit a signed 32-bit int (`int32`). Nothing exceeds 2^53-1. Money
  is a decimal string (ADR-0005).
- **Function tools:** `runtime: {language: node|dotnet|python, version}`, with
  a handler syntax for each language:
  - node: `file.mjs#export`
  - dotnet: `Assembly::Namespace.Type.Method`
  - python: `module:function`
  A version bump does not change the schema.
- **Formats:** format assertion is required (ADR-0006). Only `uri`, `uuid`
  and `hostname` are used.
- **YAML:** YAML 1.2 core schema only (ADR-0011).
- **Egress:** `httpsUrl` rejects link-local (cloud metadata) addresses.
  Runtimes must still enforce an egress policy for tool calls (SSRF), because a
  schema cannot know which private ranges are legitimate in a given deployment.

## Consequences

- Patterns are harder to read. The readable forms are kept in `$comment`.
- Some legitimate regex features are unavailable in policies. That is the
  price of matching in linear time.

## Alternatives considered

- **RFC 9485 I-Regexp as-is.** It is close to our subset, but it is implicitly
  anchored, and no mainstream validator implements it natively yet.
