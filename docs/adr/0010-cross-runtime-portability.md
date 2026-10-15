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
- **User-supplied regexes** (`Policy.match.patterns`) run against model
  output, which an attacker can influence. Three layers apply:
  1. **Schema subset (`safeRegex`).** A single scan that is aware of escapes
     and character classes rejects `*`, `+`, open-ended `{n,}`, repeated
     groups (`(…){m,n}`), lookaround, backreferences, inline flags, named and
     atomic groups, and possessive quantifiers. Optional groups `(…)?` and
     `(?:…)` are allowed, as are bounded single-atom repeats. This rejects
     every exponential construct, for example `(a+)+$`, `(a|a)*` and
     `(\w+\s?)+$`. Case-insensitive matching uses `match.caseInsensitive`.
  2. **Linear-time matching is required.** The subset alone does not make a
     backtracking engine safe, because adjacent bounded repeats are still
     polynomial in their bounds. Measured: `[^ ]{0,500}[^ ]{0,500}!` did not
     finish within several minutes on 1 MB in JavaScript's native RegExp.
     The reference matcher is `compilePolicyPattern()` (RE2 semantics via
     `re2js`, using its lazy DFA). .NET runtimes must use
     `RegexOptions.NonBacktracking`.
  3. **Complexity cap:** at most 128 compiled instructions. When RE2's DFA
     runs out of cache, for example on `[ab]{0,32}a[ab]{31}!`, which needs
     about 2^31 states, matching falls back to the NFA. That is still linear,
     but costs about 20 ns per instruction per byte in JavaScript. The cap
     bounds that constant.

  The loader rejects patterns that fail the cap or do not compile, with
  `invalid-regex`. Tests: accepted patterns match 1 MB of hostile input in
  under 1 s, and the forced DFA-explosion fallback stays under 3 s per MB.
  `format: regex` is banned by the meta-lint.
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
