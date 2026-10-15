# 0005. ModelBinding modes, fallbacks and budgets

- **Status:** Accepted
- **Date:** 2026-10-15
- **Requirements:** SR-SPEC-02, SR-SPEC-03

## Context

Sirb customers either bring their own provider keys (**byok**) or consume
models that Sirb pays for and re-bills (**billable**). Both need resilience
(fallbacks) and cost control (budgets). Billable usage is Sirb's own financial
exposure.

## Decision

- `spec.mode` is required, and is one of `byok` or `billable`.
  - **byok** requires `credentials` (a `secretSource`). An `endpoint` is allowed.
  - **billable** forbids `credentials` and `endpoint`, because Sirb holds the
    keys and the endpoints. It **requires `budget`**, so Sirb never carries
    unbounded spend.
- `provider` `azure-openai` or `openai-compatible` requires `endpoint`.
  Through the rule above, this also makes such bindings byok in practice.
- **`fallbacks`** is an ordered list of 1 to 5 entries. Each entry is
  `{ref, on?}`, where `ref` names another ModelBinding and `on` lists triggers
  from `error`, `timeout`, `rate-limit` and `budget-exceeded`. Order sets the
  priority. Each fallback is a separate ModelBinding, so it brings its own
  mode, credentials and budget. A billable binding can fall back to a byok one
  and the reverse. Checking that the referenced binding exists and that the
  chain has no cycles is semantic (ADR-0006).
- **`budget`** is per binding and has the form
  `{currency, limit, period, onExceeded, alertThresholds?}`.
  - `currency` is an ISO 4217 code (`^[A-Z]{3}$`).
  - `limit` must be greater than 0.
  - `period` is one of `hour`, `day`, `week`, `month` or `total`.
  - `onExceeded` is one of `block`, `fallback` or `notify`. `fallback`
    requires `fallbacks`.
  - `alertThresholds` are fractions in (0, 1].
  - A budget is optional for byok and mandatory for billable.

## Consequences

- Billing and secret-handling invariants are enforced before deployment.
- A byok binding without credentials, such as a local Ollama, is not
  expressible in v1alpha1. This is deferred to v1beta1. One option is
  `credentials: {none: true}` together with an explicit network-policy check.
- Budget accounting granularity (calendar vs rolling periods) is left to the
  runtime.

## Alternatives considered

- **Fallbacks as inline model blocks.** These would duplicate the credentials
  and budget logic, and would make fallback-of-fallback unclear.
- **A global budget only.** It could not limit a single expensive binding.
