# 0005. ModelBinding modes, fallbacks and budgets

- **Status:** Accepted (revised after the PR #1 review)
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-02, SR-SPEC-04

## Context

Sirb customers either bring their own provider keys (**byok**) or use models
that Sirb pays for and bills on (**billable**). Both need resilience
(fallbacks) and cost control (budgets). Billable usage is Sirb's own financial
exposure. On-premises and edge deployments run local model servers such as
Ollama.

## Decision

- `spec.mode` is required and is either `byok` or `billable`.
  - **byok** requires `credentials` (a `secretRef`) for every hosted provider.
  - **billable** forbids `credentials` and `endpoint`, because Sirb holds the
    keys and the endpoints. It also **requires `budget`**.
- **Local models.** `provider: ollama` is always byok and requires an
  `endpoint`. Its credentials are optional. Its endpoint can be https or a
  loopback-only `http://localhost|127.0.0.1|[::1]` URL. Every other provider
  needs an https endpoint. `azure-openai` and `openai-compatible` also require
  an `endpoint`.
- **`fallbacks`** is an ordered list of 1 to 5 entries of the form
  `{ref, triggers?}`.
  - `triggers` lists which of `error`, `timeout`, `rate-limit` and
    `budget-exceeded` start the fallback.
  - The field is called `triggers`, not `on`, because YAML 1.1 parsers read a
    bare `on` as boolean `true`.
  - Each fallback is a separate ModelBinding with its own mode, credentials and budget.
- **`budget`** has the form `{currency, limit, period, onExceeded, alertThresholds?}`.
  - `currency` is one of the supported ISO 4217 codes: USD, EUR, GBP, EGP,
    SAR, AED, JPY, INR, CAD, AUD or CHF.
  - `limit` is a **decimal string**, for example `"1000.50"`. It must be
    greater than 0 and has at most 12 integer digits and 6 fraction digits.
    JSON numbers parse to `double` in JavaScript and to `decimal` or `double`
    in .NET, so money is never stored as a JSON number (ADR-0010).
  - `onExceeded` is `block`, `fallback` or `notify`. `fallback` requires `fallbacks`.

## Consequences

- Billing and secret-handling rules are checked before deployment.
- Adding a currency means adding an enum value, which is not a breaking change.
- A fallback chain with a cycle, or with a reference that doesn't exist, is
  only caught by a semantic check (ADR-0006).

## Alternatives considered

- **Integer minor units (`limitMinor`).** Precise, but easy to get wrong by a
  factor of 100, and not every currency has two decimal places.
- **Dropping `ollama` from v1alpha1.** On-premises targets need it early.
